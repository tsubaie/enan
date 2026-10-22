// Package updater keeps an Enan install on the newest image of its channel: check, pull, back up,
// switch, verify, and roll the image back when the new one fails (ADR 0051).
package updater

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/tsubaie/enan/updater/internal/docker"
	"github.com/tsubaie/enan/updater/internal/registry"
)

// Engine is the part of the Docker API the updater uses (docker.Client in production).
type Engine interface {
	InspectContainer(ctx context.Context, id string) (docker.Container, error)
	ListContainers(ctx context.Context, labels map[string]string) ([]string, error)
	InspectImage(ctx context.Context, ref string) (docker.Image, error)
	PlatformManifest(ctx context.Context, ref string) (string, error)
	Pull(ctx context.Context, repository, digest string) error
	Tag(ctx context.Context, image, repository, tag string) error
	ImagesOf(ctx context.Context, repository string) ([]string, error)
	RemoveImage(ctx context.Context, id string) error
	Create(ctx context.Context, name string, config, hostConfig, endpoints map[string]any) (string, error)
	Start(ctx context.Context, id string) error
	Stop(ctx context.Context, id string, timeout time.Duration) error
	Rename(ctx context.Context, id, name string) error
	Remove(ctx context.Context, id string) error
	Exec(ctx context.Context, id string, command []string) (int, string, error)
	Logs(ctx context.Context, id string, lines int) (string, error)
}

// Registry resolves a tag to a digest (registry.Client in production).
type Registry interface {
	Digest(ctx context.Context, ref registry.Reference) (string, error)
}

// Health is what the app's /api/v1/health says, read by a Prober.
type Health struct {
	DB       bool   `json:"db"`
	Version  string `json:"version"`
	Revision string `json:"revision"`
}

// Prober reads a container's /api/v1/health (HTTPProber in production).
type Prober interface {
	Probe(ctx context.Context, container docker.Container) (Health, error)
}

// Notifier sends an alert that does not depend on Enan being up (Webhook in production).
type Notifier interface {
	Notify(ctx context.Context, event string, status Status) error
}

type Updater struct {
	Config   Config
	Engine   Engine
	Registry Registry
	Prober   Prober
	Notifier Notifier
	Log      *slog.Logger
	Now      func() time.Time
	// Self is the updater's own container id, for its self-update check; empty outside a container.
	Self string

	state  State
	status Status
	store  store
}

func (u *Updater) now() time.Time {
	if u.Now != nil {
		return u.Now()
	}
	return time.Now()
}

// Open loads the persisted state and takes the lock that keeps a second updater out.
func (u *Updater) Open() (func(), error) {
	u.store = store{dir: u.Config.StatusDir}
	for _, dir := range []string{u.Config.StatusDir, u.Config.CommandsDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	lock, err := os.OpenFile(u.store.path("lock"), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		return nil, fmt.Errorf("another updater holds %s", u.store.path("lock"))
	}
	if err := u.store.read("state.json", &u.state); err != nil {
		lock.Close()
		return nil, fmt.Errorf("state.json: %w", err)
	}
	if err := u.store.read("status.json", &u.status); err != nil {
		lock.Close()
		return nil, fmt.Errorf("status.json: %w", err)
	}
	if u.state.Phase == "" {
		u.state.Phase = Idle
	}
	if u.state.Rejected == nil {
		u.state.Rejected = map[string]string{}
	}
	if u.state.Alerted == nil {
		u.state.Alerted = map[string]bool{}
	}
	return func() { lock.Close() }, nil
}

func (u *Updater) save() error { return u.store.write("state.json", u.state) }

func (u *Updater) publish() {
	u.status.Paused = u.state.Paused
	if err := u.store.write("status.json", u.status); err != nil {
		u.Log.Error("writing status", "error", err)
	}
}

// finish records an outcome, adds it to the history and alerts on everything but a quiet check.
func (u *Updater) finish(ctx context.Context, outcome string, alertKey string) {
	u.status.State = outcome
	u.status.FinishedAt = u.now()
	u.publish()
	if err := u.store.appendHistory(u.status); err != nil {
		u.Log.Error("writing history", "error", err)
	}
	u.Log.Info("outcome", "state", outcome, "step", u.status.Step, "error", u.status.Error)
	if outcome == Checked || u.Notifier == nil {
		return
	}
	if alertKey != "" {
		if u.state.Alerted[alertKey] {
			return
		}
		u.state.Alerted[alertKey] = true
		_ = u.save()
	}
	if err := u.Notifier.Notify(ctx, outcome, u.status); err != nil {
		u.Log.Error("alert", "error", err)
	}
}

// app finds the Enan container: by name, or by compose project and service.
func (u *Updater) app(ctx context.Context) (docker.Container, error) {
	if u.Config.Container != "" {
		return u.Engine.InspectContainer(ctx, u.Config.Container)
	}
	project := u.Config.Project
	if project == "" && u.Self != "" {
		if self, err := u.Engine.InspectContainer(ctx, u.Self); err == nil {
			project = self.Labels()["com.docker.compose.project"]
		}
	}
	if project == "" {
		return docker.Container{}, errors.New("no compose project: set ENAN_PROJECT or ENAN_APP_CONTAINER")
	}
	ids, err := u.Engine.ListContainers(ctx, map[string]string{
		"com.docker.compose.project": project,
		"com.docker.compose.service": u.Config.Service,
	})
	if err != nil {
		return docker.Container{}, err
	}
	for _, id := range ids {
		container, err := u.Engine.InspectContainer(ctx, id)
		if err != nil {
			return docker.Container{}, err
		}
		if !strings.HasSuffix(container.Name, previousSuffix) {
			return container, nil
		}
	}
	return docker.Container{}, fmt.Errorf("no %q container in compose project %q", u.Config.Service, project)
}

// describe reads an image's identity from its labels.
func describe(image docker.Image, digest string) *Image {
	labels := image.Labels()
	number := func(key string) int {
		n, _ := strconv.Atoi(labels[key])
		return n
	}
	return &Image{
		Digest:   digest,
		ID:       image.ID,
		Version:  labels["org.opencontainers.image.version"],
		Revision: labels["org.opencontainers.image.revision"],
		Schema:   number("org.enan.schema"),
		Contract: number("org.enan.contract"),
	}
}

// digestIn returns the image's digest in repository, if it was pulled from there.
func digestIn(image docker.Image, repository string) string {
	for _, entry := range image.RepoDigests {
		if name, digest, ok := strings.Cut(entry, "@"); ok && name == repository {
			return digest
		}
	}
	return ""
}

// major is the first number of a version such as 1.4.2, or -1.
func major(version string) int {
	head, _, _ := strings.Cut(version, ".")
	n, err := strconv.Atoi(head)
	if err != nil {
		return -1
	}
	return n
}

// Check runs one update cycle.
func (u *Updater) Check(ctx context.Context) {
	if u.state.Paused {
		u.status.LastCheckAt = u.now()
		u.status.State = Paused
		u.publish()
		return
	}
	u.status = Status{Channel: u.status.Channel, Running: u.status.Running, UpdaterUpdate: u.status.UpdaterUpdate, LastCheckAt: u.now(), StartedAt: u.now()}
	u.status.Step = "check"
	app, err := u.app(ctx)
	if err != nil {
		u.fail(ctx, "check", err, "check:"+err.Error())
		return
	}
	ref, err := registry.Parse(app.Ref())
	if err != nil {
		u.fail(ctx, "check", err, "check:"+err.Error())
		return
	}
	channel := ref
	if u.Config.Channel != "" {
		channel.Tag = u.Config.Channel
	}
	u.status.Channel = channel.Tag
	runningImage, err := u.Engine.InspectImage(ctx, app.Image)
	if err != nil {
		u.fail(ctx, "check", err, "")
		return
	}
	running := describe(runningImage, digestIn(runningImage, ref.Repository))
	u.status.Running = running
	digest, err := u.Registry.Digest(ctx, channel)
	if err != nil {
		u.fail(ctx, "check", err, "check:"+err.Error())
		return
	}
	u.checkSelf(ctx)
	if digest == running.Digest {
		u.status.Step = ""
		u.finish(ctx, Checked, "")
		return
	}
	if reason, rejected := u.state.Rejected[digest]; rejected {
		u.status.Candidate = &Image{Digest: digest}
		u.status.Error = fmt.Sprintf("this image failed before (%s); run `enan-updater retry` to try it again", reason)
		u.finish(ctx, Blocked, "rejected:"+digest)
		return
	}
	u.status.Step = "pull"
	if err := u.Engine.Pull(ctx, ref.Repository, digest); err != nil {
		u.fail(ctx, "pull", err, "pull:"+digest)
		return
	}
	pulled, err := u.Engine.InspectImage(ctx, ref.Repository+"@"+digest)
	if err != nil {
		u.fail(ctx, "pull", err, "pull:"+digest)
		return
	}
	candidate := describe(pulled, digest)
	u.status.Candidate = candidate
	if candidate.ID == running.ID {
		// The same image under another digest (re-tagged); nothing to install.
		u.status.Running.Digest = digest
		u.status.Step = ""
		u.finish(ctx, Checked, "")
		return
	}
	if reason := u.guard(running, candidate); reason != "" {
		u.status.Step = "guard"
		u.status.Error = reason
		u.finish(ctx, Blocked, "blocked:"+digest)
		return
	}
	u.install(ctx, app, ref, running, candidate)
}

// guard returns why a candidate must not be installed automatically, or "".
func (u *Updater) guard(running, candidate *Image) string {
	if !u.Config.AllowMajor && major(running.Version) >= 0 && major(candidate.Version) > major(running.Version) {
		return fmt.Sprintf("%s is a new major version after %s; set ENAN_ALLOW_MAJOR=true to install it", candidate.Version, running.Version)
	}
	if !u.Config.AllowContract && candidate.Contract > running.Schema {
		return fmt.Sprintf("migration %d of %s cannot be undone by going back to %s (ADR 0050); back up, then set ENAN_ALLOW_CONTRACT=true to install it", candidate.Contract, versionOf(candidate), versionOf(running))
	}
	return ""
}

func versionOf(image *Image) string {
	if image.Version != "" {
		return image.Version
	}
	return strings.TrimPrefix(image.Digest, "sha256:")[:min(12, len(strings.TrimPrefix(image.Digest, "sha256:")))]
}

func (u *Updater) fail(ctx context.Context, step string, err error, alertKey string) {
	u.status.Step = step
	u.status.Error = err.Error()
	u.finish(ctx, Failed, alertKey)
}

// install backs up, switches to the candidate, verifies it, and rolls back on failure.
func (u *Updater) install(ctx context.Context, app docker.Container, ref registry.Reference, running, candidate *Image) {
	u.status.State = Updating
	u.status.Step = "backup"
	u.publish()
	backup, err := u.backup(ctx, app)
	if err != nil {
		u.fail(ctx, "backup", err, "backup:"+candidate.Digest)
		return
	}
	u.status.Backup = backup
	u.status.RestoreCommand = fmt.Sprintf("docker compose exec %s pnpm backup:restore %s/%s --confirm", u.Config.Service, u.Config.BackupDir, backup)
	if err := u.switchTo(ctx, app, ref, running, candidate, backup); err != nil {
		u.recoverFrom(ctx, err)
		return
	}
	u.complete(ctx)
}

// backup runs the app's own backup command and returns the backup's id.
func (u *Updater) backup(ctx context.Context, app docker.Container) (string, error) {
	code, output, err := u.Engine.Exec(ctx, app.ID, u.Config.BackupCommand)
	if err != nil {
		return "", err
	}
	if code != 0 {
		return "", fmt.Errorf("%s exited %d: %s", strings.Join(u.Config.BackupCommand, " "), code, tail(output, 20))
	}
	lines := strings.Split(strings.TrimSpace(output), "\n")
	var manifest struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), &manifest); err != nil || manifest.ID == "" {
		return "", fmt.Errorf("the backup command printed no backup id: %s", tail(output, 5))
	}
	return manifest.ID, nil
}

// switchTo replaces the app container with one on target. The old container is renamed and kept
// until the new one is verified, so going back is a rename and a start.
func (u *Updater) switchTo(ctx context.Context, app docker.Container, ref registry.Reference, previous, target *Image, backup string) error {
	oldImage, err := u.Engine.InspectImage(ctx, app.Image)
	if err != nil {
		return err
	}
	u.state.Phase = Switching
	u.state.Target, u.state.Previous = target, previous
	u.state.PreviousContainer, u.state.Name, u.state.Ref = app.ID, app.Name, app.Ref()
	u.state.Backup = backup
	if err := u.save(); err != nil {
		return err
	}
	u.status.Step = "switch"
	u.publish()
	// The name compose uses now means the target, so a later `docker compose up` keeps it.
	if err := u.Engine.Tag(ctx, target.ID, ref.Repository, ref.Tag); err != nil {
		return err
	}
	spec := Recreation(app, oldImage, app.Ref())
	if labels, ok := spec.Config["Labels"].(map[string]any); ok {
		if recorded, ok := labels[composeImageLabel].(string); ok {
			labels[composeImageLabel] = u.composeImage(ctx, recorded, oldImage.ID, target.ID)
		}
	}
	if err := u.Engine.Stop(ctx, app.ID, u.Config.StopTimeout); err != nil {
		return err
	}
	if err := u.Engine.Rename(ctx, app.ID, app.Name+previousSuffix); err != nil {
		return err
	}
	id, err := u.Engine.Create(ctx, app.Name, spec.Config, spec.HostConfig, spec.Endpoints)
	if err != nil {
		return err
	}
	u.state.Phase = Verifying
	if err := u.save(); err != nil {
		return err
	}
	if err := u.Engine.Start(ctx, id); err != nil {
		return err
	}
	u.status.Step = "verify"
	u.publish()
	return u.verify(ctx, id, target)
}

// composeImageLabel is where compose records the image a container was created from. A container
// whose label differs from what its service resolves to now is recreated by the next
// `docker compose up`.
const composeImageLabel = "com.docker.compose.image"

// composeImage returns the label value compose would record for the new image, written the way
// the old container's was: the image id (classic store) or the platform manifest digest
// (containerd store). An unrecognised value is kept; compose then recreates the container once,
// on the same new image.
func (u *Updater) composeImage(ctx context.Context, recorded, oldID, newID string) string {
	// The manifest first: an image pushed without an index has an id equal to its manifest digest,
	// so only the store's own answer for the old image tells the two schemes apart.
	if old, err := u.Engine.PlatformManifest(ctx, oldID); err == nil && old != "" && old == recorded {
		if fresh, err := u.Engine.PlatformManifest(ctx, newID); err == nil && fresh != "" {
			return fresh
		}
	}
	if recorded == oldID {
		return newID
	}
	return recorded
}

// verify waits until the container is healthy and its /api/v1/health names the expected image.
func (u *Updater) verify(ctx context.Context, id string, expected *Image) error {
	deadline := u.now().Add(u.Config.HealthTimeout)
	last := errors.New("not checked yet")
	for {
		container, err := u.Engine.InspectContainer(ctx, id)
		switch {
		case err != nil:
			last = err
		case !container.State.Running:
			return errors.New("the container stopped")
		case container.State.Health != nil && container.State.Health.Status == "unhealthy":
			return errors.New("the container's health check reports unhealthy")
		case container.State.Health != nil && container.State.Health.Status != "healthy":
			last = fmt.Errorf("health check %s", container.State.Health.Status)
		default:
			health, err := u.Prober.Probe(ctx, container)
			switch {
			case err != nil:
				last = err
			case !health.DB:
				last = errors.New("/api/v1/health reports db: false")
			case expected.Version != "" && health.Version != expected.Version:
				last = fmt.Errorf("/api/v1/health reports version %s, expected %s", health.Version, expected.Version)
			case expected.Revision != "" && health.Revision != expected.Revision:
				last = fmt.Errorf("/api/v1/health reports revision %s, expected %s", health.Revision, expected.Revision)
			default:
				return nil
			}
		}
		if !u.now().Before(deadline) {
			return fmt.Errorf("not healthy within %s: %w", u.Config.HealthTimeout, last)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(u.pause()):
		}
	}
}

func (u *Updater) pause() time.Duration {
	return min(3*time.Second, u.Config.HealthTimeout/10+time.Millisecond)
}

// complete removes the replaced container and keeps its image as the way back.
func (u *Updater) complete(ctx context.Context) {
	if err := u.Engine.Remove(ctx, u.state.PreviousContainer); err != nil && !errors.Is(err, docker.ErrNotFound) {
		u.Log.Warn("removing the previous container", "error", err)
	}
	target, previous := u.state.Target, u.state.Previous
	u.state = State{Phase: Idle, Paused: u.state.Paused, LastPrevious: previous, Rejected: u.state.Rejected, Alerted: u.state.Alerted}
	_ = u.save()
	u.status.Running, u.status.Candidate = target, nil
	u.status.Step, u.status.Error = "", ""
	u.cleanImages(ctx, target, previous)
	u.finish(ctx, Updated, "")
}

// recoverFrom puts the previous container back after a failed switch or verification. The
// database is never restored: the status names the backup and the command, for a person.
func (u *Updater) recoverFrom(ctx context.Context, cause error) {
	step := u.status.Step
	u.status.Error = cause.Error()
	if current, err := u.Engine.InspectContainer(ctx, u.state.Name); err == nil && current.ID != u.state.PreviousContainer {
		if logs, err := u.Engine.Logs(ctx, current.ID, 200); err == nil {
			u.status.Log = tail(logs, 200)
		}
	}
	u.Log.Warn("rolling back", "step", step, "error", cause)
	if err := u.rollback(ctx); err != nil {
		u.status.Step = step
		u.status.Error = fmt.Sprintf("%s; rolling back also failed: %s", cause, err)
		u.finish(ctx, RollbackFailed, "")
		return
	}
	if u.state.Target != nil {
		u.state.Rejected[u.state.Target.Digest] = fmt.Sprintf("%s at %s", step, u.now().UTC().Format(time.RFC3339))
	}
	u.status.Running = u.state.Previous
	u.status.Step = step
	u.state = State{Phase: Idle, Paused: u.state.Paused, LastPrevious: u.state.LastPrevious, Rejected: u.state.Rejected, Alerted: u.state.Alerted}
	_ = u.save()
	u.finish(ctx, RolledBack, "")
}

// rollback removes the new container, renames the previous one back and starts it.
func (u *Updater) rollback(ctx context.Context) error {
	name, previous := u.state.Name, u.state.PreviousContainer
	if current, err := u.Engine.InspectContainer(ctx, name); err == nil && current.ID != previous {
		if err := u.Engine.Remove(ctx, current.ID); err != nil {
			return err
		}
	}
	if ref, err := registry.Parse(u.state.Ref); err == nil && u.state.Previous != nil && u.state.Previous.ID != "" {
		if err := u.Engine.Tag(ctx, u.state.Previous.ID, ref.Repository, ref.Tag); err != nil {
			return err
		}
	}
	container, err := u.Engine.InspectContainer(ctx, previous)
	if err != nil {
		return fmt.Errorf("the previous container is gone: %w", err)
	}
	if container.Name != name {
		if err := u.Engine.Rename(ctx, previous, name); err != nil {
			return err
		}
	}
	if !container.State.Running {
		if err := u.Engine.Start(ctx, previous); err != nil {
			return err
		}
	}
	expected := &Image{}
	if u.state.Previous != nil {
		expected = u.state.Previous
	}
	return u.verify(ctx, previous, expected)
}

// Recover finishes or reverses an update the process was stopped in the middle of.
func (u *Updater) Recover(ctx context.Context) {
	switch u.state.Phase {
	case Idle:
		return
	case Verifying:
		if current, err := u.Engine.InspectContainer(ctx, u.state.Name); err == nil && current.ID != u.state.PreviousContainer {
			u.status.Step = "verify"
			if err := u.verify(ctx, current.ID, u.state.Target); err == nil {
				u.Log.Info("recovered: the new container verified after a restart")
				u.complete(ctx)
				return
			}
		}
	}
	u.Log.Warn("recovering an interrupted update", "phase", u.state.Phase)
	u.status.Step = string(u.state.Phase)
	u.recoverFrom(ctx, fmt.Errorf("the updater stopped during %s", u.state.Phase))
}

// cleanImages removes images of the repository other than the running one and the way back.
func (u *Updater) cleanImages(ctx context.Context, keep ...*Image) {
	ref, err := registry.Parse(u.state.Ref)
	if err != nil {
		if app, appErr := u.app(ctx); appErr == nil {
			ref, err = registry.Parse(app.Ref())
		}
	}
	if err != nil {
		return
	}
	ids, err := u.Engine.ImagesOf(ctx, ref.Repository)
	if err != nil {
		return
	}
	for _, id := range ids {
		kept := false
		for _, image := range keep {
			kept = kept || image != nil && image.ID == id
		}
		if !kept {
			// An image a container still uses is refused by the daemon, which is what we want.
			_ = u.Engine.RemoveImage(ctx, id)
		}
	}
}

// checkSelf alerts once per new updater image; the operator applies it (README § Automatic updates).
func (u *Updater) checkSelf(ctx context.Context) {
	if u.Self == "" {
		return
	}
	self, err := u.Engine.InspectContainer(ctx, u.Self)
	if err != nil {
		return
	}
	ref, err := registry.Parse(self.Ref())
	if err != nil {
		return
	}
	image, err := u.Engine.InspectImage(ctx, self.Image)
	if err != nil {
		return
	}
	latest, err := u.Registry.Digest(ctx, ref)
	if err != nil || latest == digestIn(image, ref.Repository) {
		u.status.UpdaterUpdate = ""
		return
	}
	u.status.UpdaterUpdate = latest
	if !u.state.Alerted["updater:"+latest] && u.Notifier != nil {
		u.state.Alerted["updater:"+latest] = true
		_ = u.save()
		_ = u.Notifier.Notify(ctx, "updater_update_available", u.status)
	}
}

// Rollback goes back to the image the last update replaced, when that is safe.
func (u *Updater) Rollback(ctx context.Context, force bool) {
	u.status = Status{Channel: u.status.Channel, Running: u.status.Running, LastCheckAt: u.status.LastCheckAt, StartedAt: u.now(), Step: "rollback"}
	target := u.state.LastPrevious
	if target == nil || target.ID == "" {
		u.fail(ctx, "rollback", errors.New("no previous image to go back to"), "")
		return
	}
	app, err := u.app(ctx)
	if err != nil {
		u.fail(ctx, "rollback", err, "")
		return
	}
	ref, err := registry.Parse(app.Ref())
	if err != nil {
		u.fail(ctx, "rollback", err, "")
		return
	}
	runningImage, err := u.Engine.InspectImage(ctx, app.Image)
	if err != nil {
		u.fail(ctx, "rollback", err, "")
		return
	}
	running := describe(runningImage, digestIn(runningImage, ref.Repository))
	if running.Contract > target.Schema && !force {
		u.fail(ctx, "rollback", fmt.Errorf("migration %d of the running image cannot be read by %s (ADR 0050); restore a backup instead, or force it", running.Contract, versionOf(target)), "")
		return
	}
	u.status.Candidate = target
	u.install(ctx, app, ref, running, target)
}

// Command is a request left in the commands folder by the CLI or by Enan.
type Command struct {
	Command string `json:"command"`
	Force   bool   `json:"force,omitempty"`
}

// Commands reads and removes pending commands, oldest first.
func (u *Updater) Commands() []Command {
	entries, err := os.ReadDir(u.Config.CommandsDir)
	if err != nil {
		return nil
	}
	var commands []Command
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		path := filepath.Join(u.Config.CommandsDir, entry.Name())
		data, err := os.ReadFile(path)
		os.Remove(path)
		var command Command
		if err != nil || json.Unmarshal(data, &command) != nil {
			u.Log.Warn("ignoring an unreadable command", "file", entry.Name())
			continue
		}
		commands = append(commands, command)
	}
	return commands
}

// Apply carries out one command; it reports whether a check should run now.
func (u *Updater) Apply(ctx context.Context, command Command) bool {
	u.Log.Info("command", "command", command.Command)
	switch command.Command {
	case "check":
		return true
	case "pause", "resume":
		u.state.Paused = command.Command == "pause"
		_ = u.save()
		u.publish()
	case "retry":
		u.state.Rejected = map[string]string{}
		u.state.Alerted = map[string]bool{}
		_ = u.save()
		return true
	case "rollback":
		u.Rollback(ctx, command.Force)
	default:
		u.Log.Warn("unknown command", "command", command.Command)
	}
	return false
}

// Run checks every interval inside the window, and acts on commands as they arrive.
func (u *Updater) Run(ctx context.Context) error {
	u.Recover(ctx)
	next := u.now()
	for {
		due := false
		for _, command := range u.Commands() {
			due = u.Apply(ctx, command) || due
		}
		if due || !u.now().Before(next) && u.Config.Window.Contains(u.now()) {
			u.Check(ctx)
			next = u.now().Add(u.Config.Interval)
		} else if !u.now().Before(next) {
			// Outside the window: still record that the updater is alive.
			u.status.LastCheckAt = u.now()
			u.publish()
			next = u.now().Add(u.Config.Interval)
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(u.Config.Poll):
		}
	}
}

func tail(text string, lines int) string {
	all := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(all) > lines {
		all = all[len(all)-lines:]
	}
	return strings.Join(all, "\n")
}
