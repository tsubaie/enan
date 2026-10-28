package updater

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/tsubaie/enan/updater/internal/docker"
)

// ADMIN-B74, ADR 0062: the updater replaces itself through a helper started from the new image.
const updaterRef = repo + ":updater"

// selfSetup is the install of setup with the updater's own container beside the app: it runs
// upd-1, and upd-2 is published under the same tag, built from different updater source.
func selfSetup(t *testing.T) (*Updater, *fake) {
	t.Helper()
	u, f, _ := setup(t)
	for id, source := range map[string]string{"upd-1": "a", "upd-2": "b"} {
		f.images[id] = docker.Image{ID: id, Config: map[string]any{
			"Cmd":    []any{"run"},
			"Labels": map[string]any{sourceLabel: source},
		}}
		f.digests["sha256:"+id] = id
	}
	f.tags[updaterRef] = "upd-1"
	image := f.images["upd-1"]
	image.RepoDigests = []string{repo + "@sha256:upd-1"}
	f.images["upd-1"] = image
	f.containers["u1-full"] = &docker.Container{
		ID: "u1-full", Name: "enan-updater-1", Image: "upd-1",
		Config: map[string]any{
			"Image":  updaterRef,
			"Cmd":    []any{"run"},
			"Env":    []any{"ENAN_CHANNEL=latest"},
			"Labels": map[string]any{"com.docker.compose.project": "enan", "com.docker.compose.service": "updater"},
		},
		HostConfig: map[string]any{
			"RestartPolicy": map[string]any{"Name": "unless-stopped"},
			"Binds":         []any{"/var/run/docker.sock:/var/run/docker.sock"},
		},
		State: docker.ContainerState{Running: true},
	}
	f.publish("updater", "sha256:upd-2")
	u.Self = "u1-full"
	return u, f
}

func helperOf(f *fake) *docker.Container {
	c, _ := f.find("enan-updater-1" + helperSuffix)
	return c
}

func TestSelfUpdate(t *testing.T) {
	for _, scenario := range []struct {
		name string
		run  func(*testing.T)
	}{
		{"ADMIN-B74 Update the updater pulls the newer image and starts the helper from it", askedSelfUpdateStartsTheHelper},
		{"ADMIN-B74 automatic installing replaces the updater within its window, and not an image that failed", automaticSelfUpdate},
		{"ADMIN-B74 an image built from the same updater source is not a newer updater", sameSourceIsNotNewer},
		{"ADMIN-B74 the helper keeps the new updater once it checks, and removes the old one", replaceKeepsANewUpdaterThatChecks},
		{"ADMIN-B74 the helper puts the old updater back when the new one does not check", replacePutsTheOldUpdaterBack},
		{"ADMIN-B74 the old updater records a failed replacement, and that image is not tried again by itself", replacementIsRecorded},
		{"ADMIN-B75 Install now replaces a newer updater first and keeps the release for it", installNowReplacesTheUpdaterFirst},
		{"ADMIN-B75 the new updater installs the release it was replaced for, without replacing itself again", theNewUpdaterInstallsTheRelease},
		{"ADMIN-B75 after a failed replacement the release is not installed: one outcome", aFailedReplacementInstallsNothing},
		{"ADMIN-B75 Install now with only a newer updater replaces it and installs nothing else", installNowWithOnlyANewerUpdater},
		{"ADMIN-B75 an updater that failed before does not stand in the way of a release", aFailedUpdaterDoesNotBlockTheRelease},
	} {
		t.Run(scenario.name, scenario.run)
	}
}

func askedSelfUpdateStartsTheHelper(t *testing.T) {
	u, f := selfSetup(t)
	u.Apply(context.Background(), Command{Command: "settings", Automatic: ptr(false)})
	u.Check(context.Background())
	if u.status.UpdaterUpdate != "sha256:upd-2" || u.selfDue() {
		t.Fatalf("announced %q, due %v before anyone asked", u.status.UpdaterUpdate, u.selfDue())
	}
	u.Apply(context.Background(), Command{Command: "update_updater"})
	if !u.selfDue() || !u.SelfUpdate(context.Background()) {
		t.Fatalf("not started: %s", u.status.Error)
	}
	if f.tags[updaterRef] != "upd-2" {
		t.Fatalf("the reference still names %s", f.tags[updaterRef])
	}
	helper := helperOf(f)
	if helper == nil || !helper.State.Running || f.tags[helper.Ref()] != "upd-2" {
		t.Fatalf("helper %+v", helper)
	}
	if cmd, _ := helper.Config["Cmd"].([]string); !slices.Equal(cmd, []string{"replace", "u1-full"}) {
		t.Fatalf("helper command %v", helper.Config["Cmd"])
	}
	if helper.HostConfig["AutoRemove"] != true || helper.Labels()["com.docker.compose.service"] != "" {
		t.Fatalf("helper is kept or joins the compose project: %v %v", helper.HostConfig, helper.Labels())
	}
	if u.status.State != Updating || u.status.Step != "updater" {
		t.Fatalf("status %s/%s", u.status.State, u.status.Step)
	}
}

func automaticSelfUpdate(t *testing.T) {
	u, _ := selfSetup(t)
	u.Check(context.Background())
	if !u.selfDue() {
		t.Fatal("automatic installing did not replace the updater")
	}
	u.Apply(context.Background(), Command{Command: "settings", Window: ptr("02:00-02:30")})
	u.Config.Zone = time.UTC
	u.Now = func() time.Time { return time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC) }
	if u.selfDue() {
		t.Fatal("replaced outside its window")
	}
	// Not left to the next daily check: the loop wakes at the window's start.
	if next, _ := u.cycle(context.Background(), u.Now().Add(24*time.Hour)); !next.Equal(time.Date(2026, 10, 24, 2, 0, 0, 0, time.UTC)) {
		t.Fatalf("next wake %s", next)
	}
	u.Apply(context.Background(), Command{Command: "settings", Window: ptr("")})
	u.state.Rejected["updater:sha256:upd-2"] = "updater at an earlier time"
	if u.selfDue() {
		t.Fatal("an image that failed before was tried again by itself")
	}
	u.state.Paused = true
	u.Apply(context.Background(), Command{Command: "update_updater"})
	if u.selfDue() {
		t.Fatal("a paused updater replaced itself")
	}
}

func sameSourceIsNotNewer(t *testing.T) {
	u, f := selfSetup(t)
	image := f.images["upd-2"]
	image.Config["Labels"] = map[string]any{sourceLabel: "a"}
	f.images["upd-2"] = image
	u.Check(context.Background())
	if u.status.UpdaterUpdate != "" {
		t.Fatalf("a rebuild of the same updater was announced: %s", u.status.UpdaterUpdate)
	}
}

// replaceSetup has the old updater running while its reference already names upd-2, as SelfUpdate
// leaves it.
func replaceSetup(t *testing.T) (*Updater, *fake) {
	t.Helper()
	u, f := selfSetup(t)
	f.tags[updaterRef] = "upd-2"
	image := f.images["upd-2"]
	image.RepoDigests = []string{repo + "@sha256:upd-2"}
	f.images["upd-2"] = image
	return u, f
}

func replaceKeepsANewUpdaterThatChecks(t *testing.T) {
	u, f := replaceSetup(t)
	f.onStart = func(id string) {
		if id != "u1-full" {
			_ = u.store.write("status.json", Status{LastCheckAt: time.Now().Add(time.Second)})
		}
	}
	if err := Replace(context.Background(), f, u.Config, "u1-full", time.Now); err != nil {
		t.Fatal(err)
	}
	current, err := f.find("enan-updater-1")
	if err != nil || current.ID == "u1-full" || current.Image != "upd-2" || !current.State.Running {
		t.Fatalf("current %+v, %v", current, err)
	}
	if current.HostConfig["RestartPolicy"].(map[string]any)["Name"] != "unless-stopped" {
		t.Fatalf("settings not kept: %v", current.HostConfig)
	}
	if _, err := f.find("u1-full"); err == nil {
		t.Fatal("the old updater was not removed")
	}
	if _, err := os.Stat(filepath.Join(u.Config.StatusDir, replacedFile)); !os.IsNotExist(err) {
		t.Fatal("a replacement that worked left word of a failure")
	}
}

func replacePutsTheOldUpdaterBack(t *testing.T) {
	u, f := replaceSetup(t)
	// The old updater reads the word of the failure when it starts again, so it is there first.
	f.onStart = func(id string) {
		if _, err := os.Stat(filepath.Join(u.Config.StatusDir, replacedFile)); id == "u1-full" && err != nil {
			t.Error("the old updater was started before the failure was written")
		}
	}
	if err := Replace(context.Background(), f, u.Config, "u1-full", time.Now); err == nil {
		t.Fatal("a new updater that never checked was kept")
	}
	old, err := f.find("enan-updater-1")
	if err != nil || old.ID != "u1-full" || !old.State.Running {
		t.Fatalf("old updater not back: %+v, %v", old, err)
	}
	if len(f.containers) != 2 {
		t.Fatalf("the new updater was left behind: %d containers", len(f.containers))
	}
	var result replaced
	if err := u.store.read(replacedFile, &result); err != nil || result.Error == "" || result.Digest != "sha256:upd-2" {
		t.Fatalf("result %+v, %v", result, err)
	}
}

func replacementIsRecorded(t *testing.T) {
	u, _ := selfSetup(t)
	_ = u.store.write(replacedFile, replaced{Digest: "sha256:upd-2", Error: "the new updater stopped before it checked", At: time.Now()})
	u.recordReplaced(context.Background())
	if u.status.State != Failed || u.status.Step != "updater" || u.state.Rejected["updater:sha256:upd-2"] == "" {
		t.Fatalf("status %s/%s, rejected %v", u.status.State, u.status.Step, u.state.Rejected)
	}
	if _, err := os.Stat(filepath.Join(u.Config.StatusDir, replacedFile)); !os.IsNotExist(err) {
		t.Fatal("the result was read twice")
	}
	u.Check(context.Background())
	if u.selfDue() {
		t.Fatal("the image that failed was tried again by itself")
	}
	u.Apply(context.Background(), Command{Command: "update_updater"})
	if !u.selfDue() {
		t.Fatal("asking again did not try it")
	}
}

// releaseSetup adds a newer app release, announced, beside the newer updater.
func releaseSetup(t *testing.T) (*Updater, *fake) {
	t.Helper()
	u, f := selfSetup(t)
	u.Apply(context.Background(), Command{Command: "settings", Automatic: ptr(false)})
	f.image("img-2", two, "1.1.0", 8, 0)
	f.publish("latest", two)
	u.Check(context.Background())
	if u.status.State != Available || u.status.UpdaterUpdate == "" {
		t.Fatalf("state %s, updater %q", u.status.State, u.status.UpdaterUpdate)
	}
	return u, f
}

func installNowReplacesTheUpdaterFirst(t *testing.T) {
	u, f := releaseSetup(t)
	u.Apply(context.Background(), Command{Command: "install", Digest: two})
	if u.state.Pending == nil || u.state.Pending.Digest != two || !u.selfDue() {
		t.Fatalf("pending %+v, due %v", u.state.Pending, u.selfDue())
	}
	if slices.Contains(f.calls, "backup") || app(t, f).Image != "img-1" {
		t.Fatalf("the app was installed by the old updater: %v", f.calls)
	}
	if !u.SelfUpdate(context.Background()) || u.status.Candidate == nil || u.status.Step != "updater" {
		t.Fatalf("status %s/%s, candidate %+v", u.status.State, u.status.Step, u.status.Candidate)
	}
}

func theNewUpdaterInstallsTheRelease(t *testing.T) {
	u, f := releaseSetup(t)
	u.Apply(context.Background(), Command{Command: "install", Digest: two})
	f.calls = nil
	// The new updater starts with the state and status the old one left.
	u.selfAsked = false
	u.resume(context.Background(), false)
	if u.state.Pending != nil || u.status.State != Updated || app(t, f).Image != "img-2" {
		t.Fatalf("state %s, pending %+v, running %s: %s", u.status.State, u.state.Pending, app(t, f).Image, u.status.Error)
	}
	if u.selfDue() || helperOf(f) != nil {
		t.Fatal("the new updater replaced itself again")
	}
}

func aFailedReplacementInstallsNothing(t *testing.T) {
	u, f := releaseSetup(t)
	u.Apply(context.Background(), Command{Command: "install", Digest: two})
	f.calls = nil
	_ = u.store.write(replacedFile, replaced{Digest: "sha256:upd-2", Error: "the new updater stopped before it checked", At: time.Now()})
	u.resume(context.Background(), u.recordReplaced(context.Background()))
	if u.state.Pending != nil || u.status.State != Failed || u.status.Step != "updater" || app(t, f).Image != "img-1" {
		t.Fatalf("state %s/%s, pending %+v, running %s", u.status.State, u.status.Step, u.state.Pending, app(t, f).Image)
	}
}

func installNowWithOnlyANewerUpdater(t *testing.T) {
	u, f := selfSetup(t)
	u.Apply(context.Background(), Command{Command: "settings", Automatic: ptr(false)})
	u.Check(context.Background())
	u.Apply(context.Background(), Command{Command: "install"})
	if !u.selfDue() || u.state.Pending == nil || u.state.Pending.Digest != "" {
		t.Fatalf("due %v, pending %+v", u.selfDue(), u.state.Pending)
	}
	u.selfAsked = false
	u.resume(context.Background(), false)
	if slices.Contains(f.calls, "backup") || u.state.Pending != nil {
		t.Fatalf("something besides the updater was installed: %v", f.calls)
	}
}

func aFailedUpdaterDoesNotBlockTheRelease(t *testing.T) {
	u, f := releaseSetup(t)
	u.state.Rejected["updater:sha256:upd-2"] = "updater at an earlier time"
	u.Apply(context.Background(), Command{Command: "install", Digest: two})
	if u.state.Pending != nil || u.selfDue() || u.status.State != Updated || app(t, f).Image != "img-2" {
		t.Fatalf("state %s, pending %+v, running %s: %s", u.status.State, u.state.Pending, app(t, f).Image, u.status.Error)
	}
}
