package updater

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tsubaie/enan/updater/internal/docker"
	"github.com/tsubaie/enan/updater/internal/registry"
)

const repo = "ghcr.io/tsubaie/enan"

// fake is an in-memory Docker daemon and registry: enough of both for the update cycle.
type fake struct {
	containers map[string]*docker.Container
	images     map[string]docker.Image // by id
	broken     map[string]bool         // image ids whose containers never become healthy
	tags       map[string]string       // repo:tag -> image id
	published  map[string]string       // tag -> digest the registry serves
	digests    map[string]string       // digest -> image id it pulls
	pulled     map[string]bool
	backupCode int
	next       int
	calls      []string
	onInspect  func() // runs at every container inspection, to read the status mid-update
}

func newFake() *fake {
	return &fake{
		containers: map[string]*docker.Container{},
		images:     map[string]docker.Image{},
		broken:     map[string]bool{},
		tags:       map[string]string{},
		published:  map[string]string{},
		digests:    map[string]string{},
		pulled:     map[string]bool{},
	}
}

// image adds a published image: digest d, version v, and its schema and contract labels.
func (f *fake) image(id, digest, version string, schema, contract int) {
	f.images[id] = docker.Image{ID: id, Config: map[string]any{
		"Env": []any{"PATH=/usr/bin", "ENAN_REVISION=" + id},
		"Cmd": []any{"node", "server.js"},
		"Labels": map[string]any{
			"org.opencontainers.image.version":  version,
			"org.opencontainers.image.revision": id,
			"org.enan.schema":                   fmt.Sprint(schema),
			"org.enan.contract":                 fmt.Sprint(contract),
		},
	}}
	f.digests[digest] = id
}

func (f *fake) publish(tag, digest string) { f.published[tag] = digest }

// run starts an app container on an image already pulled and tagged as ref.
func (f *fake) run(ref string, id string) string {
	f.tags[ref] = id
	image := f.images[id]
	image.RepoDigests = append(image.RepoDigests, repo+"@"+f.digestOf(id))
	f.images[id] = image
	config := map[string]any{
		"Image":    ref,
		"Hostname": "c1c1c1c1c1c1",
		"Env":      []any{"PATH=/usr/bin", "ENAN_REVISION=" + id, "SESSION_SECRET=s"},
		"Cmd":      []any{"node", "server.js"},
		"Labels": map[string]any{
			"com.docker.compose.project":       "enan",
			"com.docker.compose.service":       "app",
			"com.docker.compose.image":         id,
			"org.opencontainers.image.version": image.Labels()["org.opencontainers.image.version"],
		},
	}
	f.containers["c1c1c1c1c1c1-full"] = &docker.Container{
		ID: "c1c1c1c1c1c1-full", Name: "enan-app-1", Image: id, Config: config,
		HostConfig: map[string]any{"RestartPolicy": map[string]any{"Name": "unless-stopped"}},
		State:      docker.ContainerState{Running: true},
	}
	f.containers["c1c1c1c1c1c1-full"].NetworkSettings.Networks = map[string]docker.Endpoint{
		"enan_default": {Aliases: []string{"app", "c1c1c1c1c1c1"}, IPAddress: "172.18.0.2"},
	}
	return "c1c1c1c1c1c1-full"
}

func (f *fake) digestOf(id string) string {
	for digest, image := range f.digests {
		if image == id {
			return digest
		}
	}
	return ""
}

func (f *fake) find(id string) (*docker.Container, error) {
	if c, ok := f.containers[id]; ok {
		return c, nil
	}
	for _, c := range f.containers {
		if c.Name == id {
			return c, nil
		}
	}
	return nil, docker.ErrNotFound
}

func (f *fake) InspectContainer(_ context.Context, id string) (docker.Container, error) {
	if f.onInspect != nil {
		f.onInspect()
	}
	c, err := f.find(id)
	if err != nil {
		return docker.Container{}, err
	}
	copy := *c
	if c.State.Running {
		status := "healthy"
		if f.broken[c.Image] {
			status = "starting"
		}
		copy.State.Health = &struct {
			Status string `json:"Status"`
		}{status}
	}
	return copy, nil
}

func (f *fake) ListContainers(_ context.Context, labels map[string]string) ([]string, error) {
	var ids []string
	for id, c := range f.containers {
		match := true
		for key, value := range labels {
			match = match && c.Labels()[key] == value
		}
		if match {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

func (f *fake) InspectImage(_ context.Context, ref string) (docker.Image, error) {
	if image, ok := f.images[ref]; ok {
		return image, nil
	}
	if name, digest, ok := strings.Cut(ref, "@"); ok && name == repo && f.pulled[digest] {
		return f.images[f.digests[digest]], nil
	}
	if id, ok := f.tags[ref]; ok {
		return f.images[id], nil
	}
	return docker.Image{}, docker.ErrNotFound
}

// PlatformManifest: the fake is a classic image store, where compose records image ids.
func (f *fake) PlatformManifest(context.Context, string) (string, error) { return "", nil }

func (f *fake) Pull(_ context.Context, repository, digest, _ string) error {
	f.calls = append(f.calls, "pull")
	id, ok := f.digests[digest]
	if !ok || repository != repo {
		return errors.New("manifest unknown")
	}
	f.pulled[digest] = true
	image := f.images[id]
	image.RepoDigests = append(image.RepoDigests, repository+"@"+digest)
	f.images[id] = image
	return nil
}

func (f *fake) Tag(_ context.Context, image, repository, tag string) error {
	f.tags[repository+":"+tag] = image
	return nil
}

func (f *fake) ImagesOf(context.Context, string) ([]string, error) {
	var ids []string
	for id := range f.images {
		ids = append(ids, id)
	}
	return ids, nil
}

func (f *fake) RemoveImage(_ context.Context, id string) error {
	for _, c := range f.containers {
		if c.Image == id {
			return errors.New("in use")
		}
	}
	delete(f.images, id)
	return nil
}

func (f *fake) Create(_ context.Context, name string, config, hostConfig, endpoints map[string]any) (string, error) {
	f.calls = append(f.calls, "create")
	if _, err := f.find(name); err == nil {
		return "", errors.New("name in use")
	}
	ref, _ := config["Image"].(string)
	f.next++
	id := fmt.Sprintf("n%d", f.next)
	c := &docker.Container{ID: id, Name: name, Image: f.tags[ref], Config: config, HostConfig: hostConfig}
	c.NetworkSettings.Networks = map[string]docker.Endpoint{"enan_default": {IPAddress: "172.18.0.9"}}
	f.containers[id] = c
	return id, nil
}

func (f *fake) Start(_ context.Context, id string) error {
	c, err := f.find(id)
	if err != nil {
		return err
	}
	c.State.Running = true
	return nil
}

func (f *fake) Stop(_ context.Context, id string, _ time.Duration) error {
	c, err := f.find(id)
	if err != nil {
		return err
	}
	c.State.Running = false
	return nil
}

func (f *fake) Rename(_ context.Context, id, name string) error {
	c, err := f.find(id)
	if err != nil {
		return err
	}
	c.Name = name
	return nil
}

func (f *fake) Remove(_ context.Context, id string) error {
	c, err := f.find(id)
	if err != nil {
		return err
	}
	delete(f.containers, c.ID)
	return nil
}

func (f *fake) Exec(context.Context, string, []string) (int, string, error) {
	f.calls = append(f.calls, "backup")
	if f.backupCode != 0 {
		return f.backupCode, "disk full", nil
	}
	return 0, "starting\n{\"id\":\"backup-1\",\"files\":{}}\n", nil
}

func (f *fake) Logs(context.Context, string, int) (string, error) { return "boom", nil }

// Labels reads a published image's labels without pulling it, as the registry's config does.
func (f *fake) Labels(_ context.Context, _ registry.Reference, digest, _ string) (map[string]string, error) {
	id, ok := f.digests[digest]
	if !ok {
		return nil, errors.New("manifest unknown")
	}
	return f.images[id].Labels(), nil
}

func (f *fake) Digest(_ context.Context, ref registry.Reference) (string, error) {
	digest, ok := f.published[ref.Tag]
	if !ok {
		return "", errors.New("tag unknown")
	}
	return digest, nil
}

// Probe answers for the image the container runs, as Enan's /api/v1/health would.
func (f *fake) Probe(_ context.Context, c docker.Container) (Health, error) {
	if f.broken[c.Image] {
		return Health{}, errors.New("connection refused")
	}
	labels := f.images[c.Image].Labels()
	return Health{DB: true, Version: labels["org.opencontainers.image.version"], Revision: labels["org.opencontainers.image.revision"]}, nil
}

type alerts []string

func (a *alerts) Notify(_ context.Context, event string, _ Status) error {
	*a = append(*a, event)
	return nil
}

// TestScenarios names each scenario after its requirement, as the TypeScript suites do.
func TestScenarios(t *testing.T) {
	for _, scenario := range []struct {
		name string
		run  func(*testing.T)
	}{
		{"ADMIN-B56 no new image is a quiet check", noNewImageIsAQuietCheck},
		{"ADMIN-B56 a new image is backed up, installed and verified", aNewImageIsBackedUpInstalledAndVerified},
		{"ADMIN-B56 a failing image is rolled back, the database untouched, and not retried", aFailingImageIsRolledBackAndNotRetried},
		{"ADMIN-B56 a failed backup switches nothing", aFailedBackupSwitchesNothing},
		{"ADMIN-B56 a contract migration waits for Install now, even when automatic; a new year does not", guards},
		{"ADMIN-B67 announce mode announces a release once, and neither downloads nor installs it", announceModeNeverInstalls},
		{"ADMIN-B67 Install now installs exactly the announced digest, not a newer one", installNowInstallsTheAnnouncedDigest},
		{"ADMIN-B67 the running build under another digest is a quiet check, read without a download", theRunningBuildRetaggedIsAQuietCheck},
		{"ADMIN-B67 Install now of a contract migration needs confirmation", installNowOfAContractMigrationNeedsConfirmation},
		{"ADMIN-B67 a paused updater installs nothing on Install now", aPausedUpdaterInstallsNothing},
		{"ADMIN-B68 automatic installing turned on installs the waiting release, and off stops", automaticOnAndOff},
		{"ADMIN-B68 automatic installs wait for the window; checks do not", automaticInstallsWaitForTheWindow},
		{"ADMIN-B68 an install from before announce mode stays automatic, once; a new one announces", anExistingInstallStaysAutomatic},
		{"ADMIN-B56 an update interrupted after the switch is finished", anUpdateInterruptedAfterTheSwitchIsFinished},
		{"ADMIN-B56 an update interrupted during the switch is reversed", anUpdateInterruptedDuringTheSwitchIsReversed},
		{"ADMIN-B56 pause and resume", pauseAndResume},
		{"ADMIN-B56 a manual rollback goes back to the replaced image", manualRollbackGoesBackToTheReplacedImage},
		{"ADMIN-B56 a failed rollback pauses the updater instead of installing the image again", aFailedRollbackPausesTheUpdater},
		{"ADMIN-B56 a shutdown during verification records nothing and the next start finishes the update", aShutdownDuringVerificationIsLeftForRecovery},
		{"ADMIN-B56 a second updater is refused", aSecondUpdaterIsRefused},
		{"ADMIN-B56 commands are read once", commandsAreReadOnce},
		{"ADMIN-B69 every status says what this updater understands", everyStatusSaysItsProtocol},
		{"ADMIN-B58 a command is acted on when it arrives, not at the next poll", aCommandIsActedOnWhenItArrives},
		{"ADMIN-B56 the history keeps the last outcomes", historyKeepsTheLastOutcomes},
		{"ADMIN-B56 an update held back is one history entry, not one per check", aHeldUpdateIsOneHistoryEntry},
	} {
		t.Run(scenario.name, scenario.run)
	}
}

func setup(t *testing.T) (*Updater, *fake, *alerts) {
	t.Helper()
	f := newFake()
	f.image("img-1", "sha256:one", "1.0.0", 7, 0)
	f.publish("latest", "sha256:one")
	f.run(repo+":latest", "img-1")
	dir := t.TempDir()
	sent := &alerts{}
	u := &Updater{
		Config: Config{
			StatusDir: filepath.Join(dir, "status"), CommandsDir: filepath.Join(dir, "commands"),
			Interval: time.Minute, HealthTimeout: 60 * time.Millisecond, StopTimeout: time.Second,
			Project: "enan", Service: "app", BackupCommand: []string{"pnpm", "backup:create"},
			BackupDir: "/var/lib/enan/backups", Poll: time.Millisecond,
		},
		Engine: f, Registry: f, Prober: f, Notifier: sent,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	closeLock, err := u.Open()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(closeLock)
	// The scenarios below are the install cycle, so automatic installing is on; announcing alone
	// is covered by the ADMIN-B67 scenarios.
	u.Apply(context.Background(), Command{Command: "settings", Automatic: ptr(true)})
	return u, f, sent
}

func ptr[T any](value T) *T { return &value }

func app(t *testing.T, f *fake) *docker.Container {
	t.Helper()
	c, err := f.find("enan-app-1")
	if err != nil {
		t.Fatal("no enan-app-1 container")
	}
	return c
}

func noNewImageIsAQuietCheck(t *testing.T) {
	u, f, sent := setup(t)
	u.Check(context.Background())
	if u.status.State != Checked || len(*sent) != 0 || len(f.calls) != 0 {
		t.Fatalf("state %s, alerts %v, calls %v", u.status.State, *sent, f.calls)
	}
}

func aNewImageIsBackedUpInstalledAndVerified(t *testing.T) {
	u, f, sent := setup(t)
	f.image("img-2", "sha256:two", "1.1.0", 8, 0)
	f.publish("latest", "sha256:two")
	u.Check(context.Background())
	if u.status.State != Updated {
		t.Fatalf("state %s: %s at %s", u.status.State, u.status.Error, u.status.Step)
	}
	if got := strings.Join(f.calls, ","); got != "pull,backup,create" {
		t.Fatalf("calls %s", got)
	}
	running := app(t, f)
	if running.Image != "img-2" || !running.State.Running || f.tags[repo+":latest"] != "img-2" {
		t.Fatalf("running %s, latest tag %s", running.Image, f.tags[repo+":latest"])
	}
	if _, err := f.find("enan-app-1" + previousSuffix); err == nil {
		t.Fatal("the replaced container was kept after a verified update")
	}
	if running.Labels()[composeImageLabel] != "img-2" {
		t.Fatalf("compose would recreate the container: %s records %s", composeImageLabel, running.Labels()[composeImageLabel])
	}
	if u.status.Backup != "backup-1" || !strings.Contains(u.status.RestoreCommand, "/var/lib/enan/backups/backup-1") {
		t.Fatalf("backup %q, restore %q", u.status.Backup, u.status.RestoreCommand)
	}
	if u.state.LastPrevious == nil || u.state.LastPrevious.ID != "img-1" || u.state.Phase != Idle {
		t.Fatalf("state %+v", u.state)
	}
	if _, ok := f.images["img-1"]; !ok {
		t.Fatal("the previous image, the way back, was removed")
	}
	if len(*sent) != 1 || (*sent)[0] != Updated {
		t.Fatalf("alerts %v", *sent)
	}
	// The new container keeps the operator's settings and takes the new image's own.
	env := strings.Join(asStrings(anySlice(running.Config["Env"])), " ")
	if !strings.Contains(env, "SESSION_SECRET=s") || strings.Contains(env, "ENAN_REVISION") {
		t.Fatalf("env %s", env)
	}
	if status, _ := os.ReadFile(filepath.Join(u.Config.StatusDir, "status.json")); !strings.Contains(string(status), `"state": "updated"`) {
		t.Fatalf("status.json %s", status)
	}
}

func anySlice(value any) any {
	if list, ok := value.([]string); ok {
		out := make([]any, len(list))
		for i, item := range list {
			out[i] = item
		}
		return out
	}
	return value
}

func aFailingImageIsRolledBackAndNotRetried(t *testing.T) {
	u, f, sent := setup(t)
	f.image("img-2", "sha256:two", "1.1.0", 8, 0)
	f.broken["img-2"] = true
	f.publish("latest", "sha256:two")
	u.Check(context.Background())
	if u.status.State != RolledBack || u.status.Step != "verify" {
		t.Fatalf("state %s at %s: %s", u.status.State, u.status.Step, u.status.Error)
	}
	running := app(t, f)
	if running.ID != "c1c1c1c1c1c1-full" || !running.State.Running || f.tags[repo+":latest"] != "img-1" {
		t.Fatalf("running %s on %s, tag %s", running.ID, running.Image, f.tags[repo+":latest"])
	}
	if len(f.containers) != 1 {
		t.Fatalf("%d containers left", len(f.containers))
	}
	if u.status.Log != "boom" || u.status.Backup != "backup-1" {
		t.Fatalf("log %q backup %q", u.status.Log, u.status.Backup)
	}
	// The database is never restored automatically: no second command ran in the app.
	if strings.Count(strings.Join(f.calls, ","), "backup") != 1 {
		t.Fatalf("calls %v", f.calls)
	}
	f.calls = nil
	u.Check(context.Background())
	if u.status.State != Blocked || len(f.calls) != 0 {
		t.Fatalf("second check: state %s, calls %v", u.status.State, f.calls)
	}
	u.Apply(context.Background(), Command{Command: "retry"})
	if len(u.state.Rejected) != 0 {
		t.Fatal("retry kept the rejection")
	}
	if strings.Join(*sent, ",") != "rolled_back,blocked" {
		t.Fatalf("alerts %v", *sent)
	}
}

func aFailedBackupSwitchesNothing(t *testing.T) {
	u, f, _ := setup(t)
	f.image("img-2", "sha256:two", "1.1.0", 8, 0)
	f.publish("latest", "sha256:two")
	f.backupCode = 1
	u.Check(context.Background())
	if u.status.State != Failed || u.status.Step != "backup" || app(t, f).Image != "img-1" {
		t.Fatalf("state %s at %s", u.status.State, u.status.Step)
	}
}

func guards(t *testing.T) {
	cases := []struct {
		name             string
		version          string
		schema, contract int
		allow            func(*Config)
		state            string
	}{
		{"a new year", "2027.1.0", 8, 0, nil, Updated},
		{"a new year with a migration the running release cannot read", "2027.1.0", 9, 8, nil, Available},
		{"a migration the running release cannot read", "1.1.0", 9, 8, nil, Available},
		{"a contract migration the running release already has", "1.1.0", 9, 7, nil, Updated},
		{"an older image that cannot read the running database", "0.9.0", 5, 0, nil, Blocked},
		{"an older image that can read the running database", "0.9.0", 6, 0, nil, Updated},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			u, f, _ := setup(t)
			if tc.allow != nil {
				tc.allow(&u.Config)
			}
			// The running image's own newest contract migration is 6.
			f.image("img-1", "sha256:one", "1.0.0", 7, 6)
			f.image("img-2", "sha256:two", tc.version, tc.schema, tc.contract)
			f.publish("latest", "sha256:two")
			u.Check(context.Background())
			if u.status.State != tc.state || u.status.Confirm != (tc.state == Available) {
				t.Fatalf("state %s, confirm %v: %s", u.status.State, u.status.Confirm, u.status.Error)
			}
		})
	}
}

func anUpdateInterruptedAfterTheSwitchIsFinished(t *testing.T) {
	u, f, _ := setup(t)
	f.image("img-2", "sha256:two", "1.1.0", 8, 0)
	f.pulled["sha256:two"] = true
	// The process stopped after creating and starting the new container.
	old := app(t, f)
	u.state = State{Phase: Verifying, Target: &Image{ID: "img-2", Version: "1.1.0", Revision: "img-2"}, Previous: &Image{ID: "img-1"},
		PreviousContainer: old.ID, Name: "enan-app-1", Ref: repo + ":latest", Rejected: map[string]string{}, Alerted: map[string]bool{}}
	old.Name, old.State.Running = "enan-app-1"+previousSuffix, false
	f.tags[repo+":latest"] = "img-2"
	id, _ := f.Create(context.Background(), "enan-app-1", map[string]any{"Image": repo + ":latest"}, nil, nil)
	_ = f.Start(context.Background(), id)
	u.Recover(context.Background())
	if u.status.State != Updated || app(t, f).Image != "img-2" || len(f.containers) != 1 {
		t.Fatalf("state %s, %d containers", u.status.State, len(f.containers))
	}
}

func anUpdateInterruptedDuringTheSwitchIsReversed(t *testing.T) {
	u, f, _ := setup(t)
	f.image("img-2", "sha256:two", "1.1.0", 8, 0)
	// The process stopped after renaming and stopping the old container, before creating the new.
	old := app(t, f)
	u.state = State{Phase: Switching, Target: &Image{ID: "img-2", Digest: "sha256:two"}, Previous: &Image{ID: "img-1", Version: "1.0.0", Revision: "img-1"},
		PreviousContainer: old.ID, Name: "enan-app-1", Ref: repo + ":latest", Rejected: map[string]string{}, Alerted: map[string]bool{}}
	old.Name, old.State.Running = "enan-app-1"+previousSuffix, false
	f.tags[repo+":latest"] = "img-2"
	u.Recover(context.Background())
	running := app(t, f)
	if u.status.State != RolledBack || running.ID != old.ID || !running.State.Running || f.tags[repo+":latest"] != "img-1" {
		t.Fatalf("state %s, running %s %v, tag %s", u.status.State, running.ID, running.State.Running, f.tags[repo+":latest"])
	}
}

func pauseAndResume(t *testing.T) {
	u, f, _ := setup(t)
	f.image("img-2", "sha256:two", "1.1.0", 8, 0)
	f.publish("latest", "sha256:two")
	u.Apply(context.Background(), Command{Command: "pause"})
	u.Check(context.Background())
	if u.status.State != Paused || len(f.calls) != 0 {
		t.Fatalf("paused: state %s, calls %v", u.status.State, f.calls)
	}
	if due := u.Apply(context.Background(), Command{Command: "resume"}); !due {
		t.Fatal("resuming did not ask for a check")
	}
	u.Check(context.Background())
	if u.status.State != Updated {
		t.Fatalf("resumed: state %s", u.status.State)
	}
}

func manualRollbackGoesBackToTheReplacedImage(t *testing.T) {
	u, f, _ := setup(t)
	f.image("img-2", "sha256:two", "1.1.0", 8, 0)
	f.publish("latest", "sha256:two")
	u.Check(context.Background())
	u.Apply(context.Background(), Command{Command: "rollback"})
	if u.status.State != Updated || app(t, f).Image != "img-1" {
		t.Fatalf("state %s: %s, running %s", u.status.State, u.status.Error, app(t, f).Image)
	}
	// The channel still names img-2; the next check must keep the operator's choice.
	u.Check(context.Background())
	if u.status.State != Blocked || app(t, f).Image != "img-1" {
		t.Fatalf("next check: state %s, running %s", u.status.State, app(t, f).Image)
	}
}

func aShutdownDuringVerificationIsLeftForRecovery(t *testing.T) {
	u, f, sent := setup(t)
	f.image("img-2", "sha256:two", "1.1.0", 8, 0)
	f.publish("latest", "sha256:two")
	// Not healthy yet when the stop arrives; the verification wait sees the cancelled context.
	f.broken["img-2"] = true
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	u.Check(ctx)
	if u.state.Phase != Verifying || u.state.Paused || len(u.state.Rejected) != 0 || len(*sent) != 0 {
		t.Fatalf("phase %s, paused %v, rejected %v, alerts %v", u.state.Phase, u.state.Paused, u.state.Rejected, *sent)
	}
	f.broken["img-2"] = false
	u.Recover(context.Background())
	if u.status.State != Updated || u.state.Paused || app(t, f).Image != "img-2" {
		t.Fatalf("after restart: state %s, paused %v, running %s", u.status.State, u.state.Paused, app(t, f).Image)
	}
}

func aFailedRollbackPausesTheUpdater(t *testing.T) {
	u, f, sent := setup(t)
	f.image("img-2", "sha256:two", "1.1.0", 8, 0)
	f.publish("latest", "sha256:two")
	f.broken["img-1"], f.broken["img-2"] = true, true
	u.Check(context.Background())
	if u.status.State != RollbackFailed || !u.state.Paused || u.state.Rejected["sha256:two"] == "" {
		t.Fatalf("state %s, paused %v, rejected %v", u.status.State, u.state.Paused, u.state.Rejected)
	}
	f.calls = nil
	u.Check(context.Background())
	if u.status.State != Paused || len(f.calls) != 0 {
		t.Fatalf("next check: state %s, calls %v", u.status.State, f.calls)
	}
	// Once the old image answers again, resuming finishes the rollback; it backs up nothing new.
	f.broken["img-1"] = false
	u.Apply(context.Background(), Command{Command: "resume"})
	// ADMIN-B58: while the rollback is retried the status says so, and the page keeps following it.
	var during string
	f.onInspect = func() {
		data, _ := os.ReadFile(filepath.Join(u.Config.StatusDir, "status.json"))
		during = string(data)
	}
	u.Check(context.Background())
	f.onInspect = nil
	if !strings.Contains(during, `"state": "updating"`) || !strings.Contains(during, `"step": "rollback"`) {
		t.Fatalf("status during the retried rollback: %s", during)
	}
	if u.status.State != RolledBack || u.state.Phase != Idle || app(t, f).Image != "img-1" || strings.Contains(strings.Join(f.calls, ","), "backup") {
		t.Fatalf("resumed: state %s, phase %s, running %s, calls %v", u.status.State, u.state.Phase, app(t, f).Image, f.calls)
	}
	u.Check(context.Background())
	if u.status.State != Blocked {
		t.Fatalf("after recovery: state %s", u.status.State)
	}
	if strings.Join(*sent, ",") != "rollback_failed,rolled_back,blocked" {
		t.Fatalf("alerts %v", *sent)
	}
}

func aSecondUpdaterIsRefused(t *testing.T) {
	u, _, _ := setup(t)
	second := &Updater{Config: u.Config, Log: u.Log}
	if _, err := second.Open(); err == nil {
		t.Fatal("two updaters held the lock")
	}
}

func commandsAreReadOnce(t *testing.T) {
	u, _, _ := setup(t)
	for i, body := range []string{`{"command":"pause"}`, `not json`} {
		if err := os.WriteFile(filepath.Join(u.Config.CommandsDir, fmt.Sprintf("%d.json", i)), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if got := u.Commands(); len(got) != 1 || got[0].Command != "pause" {
		t.Fatalf("commands %v", got)
	}
	if again := u.Commands(); len(again) != 0 {
		t.Fatalf("commands read twice: %v", again)
	}
}

func everyStatusSaysItsProtocol(t *testing.T) {
	u, _, _ := setup(t)
	u.Check(context.Background())
	status, _ := os.ReadFile(filepath.Join(u.Config.StatusDir, "status.json"))
	if Protocol < 1 || !strings.Contains(string(status), fmt.Sprintf(`"protocol": %d`, Protocol)) {
		t.Fatalf("status.json %s", status)
	}
}

func aCommandIsActedOnWhenItArrives(t *testing.T) {
	u, _, _ := setup(t)
	u.Config.Poll, u.Config.Interval = time.Hour, time.Hour
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- u.Run(ctx) }()
	defer func() {
		cancel()
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}()
	status := filepath.Join(u.Config.StatusDir, "status.json")
	// Wait for the start check, so the command below arrives while Run waits.
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(10 * time.Millisecond) {
		if data, _ := os.ReadFile(status); strings.Contains(string(data), `"lastCheckAt"`) {
			break
		} else if time.Now().After(deadline) {
			t.Fatalf("no start check: %s", data)
		}
	}
	temporary := filepath.Join(u.Config.CommandsDir, ".pause.tmp")
	if err := os.WriteFile(temporary, []byte(`{"command":"pause"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(temporary, filepath.Join(u.Config.CommandsDir, "pause.json")); err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(10 * time.Millisecond) {
		if data, _ := os.ReadFile(status); strings.Contains(string(data), `"paused": true`) {
			return
		} else if time.Now().After(deadline) {
			t.Fatalf("the command waited for the poll: %s", data)
		}
	}
}

func historyKeepsTheLastOutcomes(t *testing.T) {
	u, _, _ := setup(t)
	for range historyLength + 5 {
		u.Check(context.Background())
	}
	data, _ := os.ReadFile(filepath.Join(u.Config.StatusDir, "history.jsonl"))
	if lines := strings.Count(string(data), "\n"); lines != historyLength {
		t.Fatalf("%d history lines", lines)
	}
}

func aHeldUpdateIsOneHistoryEntry(t *testing.T) {
	u, f, sent := setup(t)
	f.image("img-2", "sha256:two", "1.1.0", 9, 8)
	f.publish("latest", "sha256:two")
	for range 5 {
		u.Check(context.Background())
	}
	data, _ := os.ReadFile(filepath.Join(u.Config.StatusDir, "history.jsonl"))
	if lines := strings.Count(string(data), "\n"); lines != 1 || u.status.State != Available {
		t.Fatalf("%d history lines, state %s", lines, u.status.State)
	}
	if len(*sent) != 1 {
		t.Fatalf("alerts %v", *sent)
	}
}

func announceModeNeverInstalls(t *testing.T) {
	u, f, sent := setup(t)
	u.Apply(context.Background(), Command{Command: "settings", Automatic: ptr(false)})
	f.image("img-2", "sha256:two", "2026.11.0", 8, 0)
	f.publish("latest", "sha256:two")
	for range 3 {
		u.Check(context.Background())
	}
	if u.status.State != Available || u.status.Candidate.Version != "2026.11.0" || u.status.Automatic {
		t.Fatalf("state %s, candidate %+v", u.status.State, u.status.Candidate)
	}
	if app(t, f).Image != "img-1" || u.status.Backup != "" || len(f.pulled) != 0 {
		t.Fatalf("installed %s or pulled %v in announce mode", app(t, f).Image, f.pulled)
	}
	if len(*sent) != 1 || (*sent)[0] != Available {
		t.Fatalf("alerts %v", *sent)
	}
}

func installNowInstallsTheAnnouncedDigest(t *testing.T) {
	u, f, _ := setup(t)
	u.Apply(context.Background(), Command{Command: "settings", Automatic: ptr(false)})
	f.image("img-2", "sha256:two", "2026.11.0", 8, 0)
	f.publish("latest", "sha256:two")
	u.Check(context.Background())
	// A newer release is published after the page showed sha256:two.
	f.image("img-3", "sha256:three", "2026.11.1", 8, 0)
	f.publish("latest", "sha256:three")
	u.Apply(context.Background(), Command{Command: "install", Digest: "sha256:two"})
	if u.status.State != Updated || app(t, f).Image != "img-2" || u.status.Backup == "" {
		t.Fatalf("state %s: %s, running %s", u.status.State, u.status.Error, app(t, f).Image)
	}
	u.Check(context.Background())
	if u.status.State != Available || u.status.Candidate.Digest != "sha256:three" || app(t, f).Image != "img-2" {
		t.Fatalf("after: state %s, running %s", u.status.State, app(t, f).Image)
	}
}

func installNowOfAContractMigrationNeedsConfirmation(t *testing.T) {
	u, f, _ := setup(t)
	f.image("img-2", "sha256:two", "2026.11.0", 9, 8)
	f.publish("latest", "sha256:two")
	u.Check(context.Background())
	if u.status.State != Available || !u.status.Confirm {
		t.Fatalf("automatic installed a contract migration: state %s", u.status.State)
	}
	u.Apply(context.Background(), Command{Command: "install", Digest: "sha256:two"})
	if u.status.State != Failed || u.status.Step != "guard" || app(t, f).Image != "img-1" || f.pulled["sha256:two"] {
		t.Fatalf("unconfirmed: state %s at %s, running %s", u.status.State, u.status.Step, app(t, f).Image)
	}
	u.Apply(context.Background(), Command{Command: "install", Digest: "sha256:two", Confirm: true})
	if u.status.State != Updated || app(t, f).Image != "img-2" || u.status.Backup == "" {
		t.Fatalf("confirmed: state %s: %s", u.status.State, u.status.Error)
	}
}

func aPausedUpdaterInstallsNothing(t *testing.T) {
	u, f, _ := setup(t)
	u.Apply(context.Background(), Command{Command: "settings", Automatic: ptr(false)})
	f.image("img-2", "sha256:two", "2026.11.0", 8, 0)
	f.publish("latest", "sha256:two")
	u.Check(context.Background())
	u.Apply(context.Background(), Command{Command: "pause"})
	u.Apply(context.Background(), Command{Command: "install", Digest: "sha256:two"})
	if app(t, f).Image != "img-1" || u.status.State != Available {
		t.Fatalf("paused: state %s, running %s", u.status.State, app(t, f).Image)
	}
}

func automaticOnAndOff(t *testing.T) {
	u, f, _ := setup(t)
	u.Apply(context.Background(), Command{Command: "settings", Automatic: ptr(false)})
	f.image("img-2", "sha256:two", "2026.11.0", 8, 0)
	f.publish("latest", "sha256:two")
	u.Check(context.Background())
	if due := u.Apply(context.Background(), Command{Command: "settings", Automatic: ptr(true)}); !due {
		t.Fatal("turning automatic on did not ask for a check")
	}
	u.Check(context.Background())
	if u.status.State != Updated || app(t, f).Image != "img-2" || !u.status.Automatic {
		t.Fatalf("on: state %s: %s", u.status.State, u.status.Error)
	}
	u.Apply(context.Background(), Command{Command: "settings", Automatic: ptr(false)})
	f.image("img-3", "sha256:three", "2026.11.1", 8, 0)
	f.publish("latest", "sha256:three")
	u.Check(context.Background())
	if u.status.State != Available || app(t, f).Image != "img-2" {
		t.Fatalf("off: state %s, running %s", u.status.State, app(t, f).Image)
	}
	var saved State
	if err := u.store.read("state.json", &saved); err != nil || saved.Automatic == nil || *saved.Automatic {
		t.Fatalf("not saved: %+v", saved)
	}
}

func automaticInstallsWaitForTheWindow(t *testing.T) {
	u, f, _ := setup(t)
	u.Config.Zone = time.UTC
	u.Now = func() time.Time { return time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC) }
	u.Apply(context.Background(), Command{Command: "settings", Window: ptr("not a window")})
	if u.state.Window != "" {
		t.Fatalf("an invalid window was kept: %q", u.state.Window)
	}
	u.Apply(context.Background(), Command{Command: "settings", Window: ptr("02:00-05:00")})
	f.image("img-2", "sha256:two", "2026.11.0", 8, 0)
	f.publish("latest", "sha256:two")
	u.Check(context.Background())
	if u.status.State != Available || u.status.Window != "02:00-05:00" || u.status.LastCheckAt.IsZero() {
		t.Fatalf("outside: state %s", u.status.State)
	}
	u.Now = func() time.Time { return time.Date(2026, 10, 24, 3, 0, 0, 0, time.UTC) }
	u.Check(context.Background())
	if u.status.State != Updated {
		t.Fatalf("inside: state %s: %s", u.status.State, u.status.Error)
	}
}

func anExistingInstallStaysAutomatic(t *testing.T) {
	open := func(dir string) (*Updater, func()) {
		u := &Updater{Config: Config{StatusDir: filepath.Join(dir, "status"), CommandsDir: filepath.Join(dir, "commands"), LegacyWindow: "02:00-05:00", Zone: time.UTC}, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
		closeLock, err := u.Open()
		if err != nil {
			t.Fatal(err)
		}
		return u, closeLock
	}
	u, closeLock := open(t.TempDir())
	closeLock()
	if u.automatic() || u.state.Window != "" {
		t.Fatalf("a new install installs automatically: %+v", u.state)
	}
	existing := t.TempDir()
	os.MkdirAll(filepath.Join(existing, "status"), 0o755)
	os.WriteFile(filepath.Join(existing, "status", "state.json"), []byte(`{"phase":"idle","paused":false}`), 0o644)
	u, closeLock = open(existing)
	if !u.automatic() || u.state.Window != "02:00-05:00" {
		t.Fatalf("an existing install was not kept automatic: %+v", u.state)
	}
	// Recorded once: turned off from the page, it stays off after a restart.
	u.Apply(context.Background(), Command{Command: "settings", Automatic: ptr(false)})
	closeLock()
	u, closeLock = open(existing)
	defer closeLock()
	if u.automatic() {
		t.Fatal("automatic came back on after a restart")
	}
}

func theRunningBuildRetaggedIsAQuietCheck(t *testing.T) {
	u, f, sent := setup(t)
	// The same image (same version and revision) published again under a new digest.
	f.digests["sha256:again"] = "img-1"
	f.publish("latest", "sha256:again")
	u.Check(context.Background())
	if u.status.State != Checked || u.status.Candidate != nil || len(f.pulled) != 0 || len(*sent) != 0 {
		t.Fatalf("state %s, candidate %+v, pulled %v, alerts %v", u.status.State, u.status.Candidate, f.pulled, *sent)
	}
}
