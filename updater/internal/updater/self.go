package updater

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"time"

	"github.com/tsubaie/enan/updater/internal/docker"
	"github.com/tsubaie/enan/updater/internal/registry"
)

// ADR 0062: the updater replaces itself, on an administrator's request or, when automatic
// installing allows it, by itself. The running updater pulls the newer image and starts a
// short-lived helper from it; the helper swaps the two containers and verifies the new one, and
// puts the old one back when it does not come up. A new image that cannot even start never touches
// anything: the helper is that image, and without it the old updater carries on.

// helperSuffix names the helper after the updater it replaces; previousSuffix (state.go) names the
// updater it replaces while the new one is verified.
const helperSuffix = "-enan-replacing"

// replacedFile is the helper's word that a replacement failed, written before the old updater is
// started again so that it reads it on start, and removed once read. A replacement that worked
// needs no word: the new updater's first check replaces the status the old one left.
const replacedFile = "replaced.json"

type replaced struct {
	Digest string    `json:"digest"`
	Error  string    `json:"error,omitempty"`
	At     time.Time `json:"at"`
}

// selfDue reports whether this updater should replace itself now: asked to, or allowed to by the
// automatic setting and its window, with a newer image known that has not failed before.
func (u *Updater) selfDue() bool {
	digest := u.status.UpdaterUpdate
	if u.Self == "" || digest == "" || u.state.Paused || u.state.Phase != Idle {
		return false
	}
	if u.selfAsked {
		return true
	}
	_, failed := u.state.Rejected["updater:"+digest]
	return !failed && u.automatic() && u.window().Contains(u.now())
}

// SelfUpdate pulls the newer updater image, points the reference this container runs at it, and
// starts the helper. It reports whether the helper is under way, after which this updater takes no
// more work: the helper stops it.
func (u *Updater) SelfUpdate(ctx context.Context) bool {
	digest := u.status.UpdaterUpdate
	u.selfAsked = false
	u.status = Status{Channel: u.status.Channel, Running: u.status.Running, Candidate: u.status.Candidate, UpdaterUpdate: digest, LastCheckAt: u.status.LastCheckAt, StartedAt: u.now(), State: Updating, Step: "updater"}
	u.publish()
	fail := func(err error) bool {
		// The Install now it was for ends here too: one outcome, nothing installed later by surprise.
		u.state.Pending = nil
		_ = u.save()
		u.fail(ctx, "updater", err, "updater:"+digest)
		return false
	}
	self, err := u.Engine.InspectContainer(ctx, u.Self)
	if err != nil {
		return fail(err)
	}
	ref, err := registry.Parse(self.Ref())
	if err != nil {
		return fail(err)
	}
	image, err := u.Engine.InspectImage(ctx, self.Image)
	if err != nil {
		return fail(err)
	}
	if err := u.Engine.Pull(ctx, ref.Repository, digest, image.Platform()); err != nil {
		return fail(err)
	}
	pulled, err := u.Engine.InspectImage(ctx, ref.Repository+"@"+digest)
	if err != nil {
		return fail(err)
	}
	// The tag compose names now means the new image, so the new container and a later `compose up`
	// both use it.
	if err := u.Engine.Tag(ctx, pulled.ID, ref.Repository, ref.Tag); err != nil {
		return fail(err)
	}
	spec := Recreation(self, image, self.Ref())
	config := maps.Clone(spec.Config)
	config["Cmd"] = []string{"replace", self.ID}
	// Not part of the compose project, and no healthcheck: it exits within minutes.
	config["Labels"] = map[string]any{"org.enan.updater.helper": self.Name}
	config["Healthcheck"] = map[string]any{"Test": []string{"NONE"}}
	host := maps.Clone(spec.HostConfig)
	host["RestartPolicy"] = map[string]any{"Name": "no"}
	host["AutoRemove"] = true
	name := self.Name + helperSuffix
	// A helper left by a replacement that died with the machine is removed first.
	if leftover, err := u.Engine.InspectContainer(ctx, name); err == nil {
		if leftover.State.Running {
			return fail(errors.New("a replacement of the updater is already under way"))
		}
		_ = u.Engine.Remove(ctx, leftover.ID)
	}
	helper, err := u.Engine.Create(ctx, name, config, host, spec.Endpoints)
	if err != nil {
		return fail(err)
	}
	if err := u.Engine.Start(ctx, helper); err != nil {
		_ = u.Engine.Remove(ctx, helper)
		return fail(err)
	}
	u.Log.Info("replacing the updater", "digest", digest, "helper", name)
	return true
}

// Replace is the helper's work: stop the updater it was started for, start one like it on the image
// its reference now names, and keep it only if it comes up, writing a fresh status within
// HealthTimeout. Otherwise the old updater is put back, told why in replacedFile.
func Replace(ctx context.Context, engine Engine, config Config, oldID string, now func() time.Time) error {
	old, err := engine.InspectContainer(ctx, oldID)
	if err != nil {
		return err
	}
	oldImage, err := engine.InspectImage(ctx, old.Image)
	if err != nil {
		return err
	}
	ref, err := registry.Parse(old.Ref())
	if err != nil {
		return err
	}
	newImage, err := engine.InspectImage(ctx, old.Ref())
	if err != nil {
		return err
	}
	digest := digestIn(newImage, ref.Repository)
	store := store{dir: config.StatusDir}
	failed := func(err error) error {
		if writeErr := store.write(replacedFile, replaced{Digest: digest, Error: err.Error(), At: now()}); writeErr != nil {
			return errors.Join(err, writeErr)
		}
		return err
	}
	spec := Recreation(old, oldImage, old.Ref())
	started := now()
	if err := engine.Stop(ctx, old.ID, config.StopTimeout); err != nil {
		return failed(fmt.Errorf("stopping the updater: %w", err))
	}
	if err := engine.Rename(ctx, old.ID, old.Name+previousSuffix); err != nil {
		err = failed(fmt.Errorf("setting the updater aside: %w", err))
		_ = engine.Start(ctx, old.ID)
		return err
	}
	putBack := func(newID string, cause error) error {
		if newID != "" {
			_ = engine.Stop(ctx, newID, config.StopTimeout)
			_ = engine.Remove(ctx, newID)
		}
		if err := engine.Rename(ctx, old.ID, old.Name); err != nil {
			cause = errors.Join(cause, fmt.Errorf("putting the previous updater back: %w", err))
		}
		err := failed(cause)
		if startErr := engine.Start(ctx, old.ID); startErr != nil {
			return errors.Join(err, fmt.Errorf("starting the previous updater: %w", startErr))
		}
		return err
	}
	newID, err := engine.Create(ctx, old.Name, spec.Config, spec.HostConfig, spec.Endpoints)
	if err != nil {
		return putBack("", fmt.Errorf("creating the new updater: %w", err))
	}
	if err := engine.Start(ctx, newID); err != nil {
		return putBack(newID, fmt.Errorf("starting the new updater: %w", err))
	}
	if err := cameUp(ctx, engine, store, newID, started, config.HealthTimeout, now); err != nil {
		return putBack(newID, err)
	}
	_ = engine.Remove(ctx, old.ID)
	return nil
}

// cameUp waits for the new updater to write a status after it started: it holds the lock, reads
// its state and reaches the registry. One that stops running fails at once.
func cameUp(ctx context.Context, engine Engine, store store, id string, since time.Time, timeout time.Duration, now func() time.Time) error {
	deadline := now().Add(timeout)
	for {
		var status Status
		if err := store.read("status.json", &status); err == nil && status.LastCheckAt.After(since) {
			return nil
		}
		container, err := engine.InspectContainer(ctx, id)
		if err != nil || !container.State.Running {
			return errors.New("the new updater stopped before it checked")
		}
		if !now().Before(deadline) {
			return fmt.Errorf("the new updater did not check within %s", timeout)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// recordReplaced reads a failed replacement's word: it is shown, alerted once, and that image is not
// tried again by itself; Install now tries it again (ADMIN-B74). It reports whether there was one.
func (u *Updater) recordReplaced(ctx context.Context) bool {
	var result replaced
	data, err := os.ReadFile(u.store.path(replacedFile))
	if err != nil || json.Unmarshal(data, &result) != nil {
		return false
	}
	_ = os.Remove(u.store.path(replacedFile))
	u.state.Rejected["updater:"+result.Digest] = fmt.Sprintf("updater at %s", result.At.UTC().Format(time.RFC3339))
	_ = u.save()
	u.status.UpdaterUpdate = result.Digest
	u.fail(ctx, "updater", fmt.Errorf("the new updater did not come up, so the previous one was put back: %s", result.Error), "updater:"+result.Digest)
	return true
}

// resume carries out the Install now an updater replaced itself for (ADR 0063): the new updater
// installs the release it was asked for. After a failed replacement nothing more is installed; the
// failure is the one outcome of that Install now.
func (u *Updater) resume(ctx context.Context, replacementFailed bool) {
	pending := u.state.Pending
	if pending == nil {
		return
	}
	u.state.Pending = nil
	_ = u.save()
	if replacementFailed || pending.Digest == "" {
		return
	}
	// This is the newer updater the status still names, from before it ran.
	u.status.UpdaterUpdate = ""
	u.Install(ctx, pending.Digest, pending.Confirm)
}

// sameSource reports whether two updater images were built from the same source: CI labels each
// with a fingerprint of updater/, so a rebuild for an app-only commit is not a newer updater.
func sameSource(running docker.Image, labels map[string]string) bool {
	source := running.Labels()[sourceLabel]
	return source != "" && source == labels[sourceLabel]
}

const sourceLabel = "org.enan.updater.source"
