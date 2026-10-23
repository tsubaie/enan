//go:build integration

package updater

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tsubaie/enan/updater/internal/docker"
	"github.com/tsubaie/enan/updater/internal/registry"
)

// ADMIN-B74, ADR 0062, against Docker: the real updater image, run as a container with the socket
// and a status folder, is replaced by a newer one through the helper, and a newer one that does not
// come up is rolled back. The test plays the old updater's part in starting the replacement
// (SelfUpdate); the helper, the swap and the verification are the containers' own.
func TestSelfUpdateIntegration(t *testing.T) {
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("no docker")
	}
	const (
		host = "localhost:5056"
		name = "enanselftest-updater-1"
	)
	images := host + "/enan-updater"
	cleanup := func() {
		exec.Command("docker", "rm", "-f", name, name+previousSuffix, name+helperSuffix, "enanselftest-registry").Run()
		out, _ := exec.Command("docker", "images", "-q", images).Output()
		for _, id := range strings.Fields(string(out)) {
			exec.Command("docker", "rmi", "-f", id).Run()
		}
	}
	cleanup()
	t.Cleanup(cleanup)
	sh(t, "run", "-d", "--name", "enanselftest-registry", "-p", "127.0.0.1:5056:5000", "registry:2")
	for i := 0; i < 50; i++ {
		if response, err := http.Get("http://" + host + "/v2/"); err == nil {
			response.Body.Close()
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	// The updater this repository builds, then two images from it: one from other source, and one
	// whose default command exits at once, so it never checks.
	sh(t, "build", "-q", "--label", sourceLabel+"=one", "-t", images+":one", "../..")
	derive := func(tag, extra string) {
		dir := t.TempDir()
		dockerfile := "FROM " + images + ":one\nLABEL " + sourceLabel + "=" + tag + "\n" + extra
		if err := os.WriteFile(filepath.Join(dir, "Dockerfile"), []byte(dockerfile), 0o644); err != nil {
			t.Fatal(err)
		}
		sh(t, "build", "-q", "-t", images+":"+tag, dir)
	}
	derive("two", "")
	derive("broken", `CMD ["status"]`+"\n")
	edge := func(tag string) string {
		sh(t, "tag", images+":"+tag, images+":edge")
		sh(t, "push", "-q", images+":edge")
		ref, err := registry.Parse(images + ":edge")
		if err != nil {
			t.Fatal(err)
		}
		digest, err := registry.New([]string{host}).Digest(context.Background(), ref)
		if err != nil {
			t.Fatal(err)
		}
		return digest
	}
	edge("one")
	status := t.TempDir()
	id := sh(t, "run", "-d", "--name", name, "--restart", "unless-stopped",
		"--label", "com.docker.compose.project=enanselftest", "--label", "com.docker.compose.service=updater",
		"-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", status+":/var/lib/enan-updater/status",
		"-e", "ENAN_PROJECT=enanselftest", "-e", "ENAN_UPDATE_INTERVAL=1h",
		"-e", "ENAN_HEALTH_TIMEOUT=20s", "-e", "ENAN_STOP_TIMEOUT=2s",
		images+":edge")
	ctx := context.Background()
	replace := func(digest string) {
		t.Helper()
		u := &Updater{
			Config:   Config{StatusDir: t.TempDir(), StopTimeout: 2 * time.Second},
			Engine:   docker.New("/var/run/docker.sock"),
			Registry: registry.New([]string{host}),
			Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
			Self:     strings.TrimSpace(sh(t, "inspect", "-f", "{{.Id}}", name)),
		}
		u.store = store{dir: u.Config.StatusDir}
		u.state.Alerted, u.state.Rejected, u.state.Phase = map[string]bool{}, map[string]string{}, Idle
		u.status.UpdaterUpdate = digest
		if !u.SelfUpdate(ctx) {
			t.Fatalf("not started: %s", u.status.Error)
		}
		// The helper removes itself once it is done.
		for i := 0; i < 120; i++ {
			if exec.Command("docker", "inspect", name+helperSuffix).Run() != nil {
				return
			}
			time.Sleep(500 * time.Millisecond)
		}
		logs, _ := exec.Command("docker", "logs", name+helperSuffix).CombinedOutput()
		t.Fatalf("the helper did not finish:\n%s", logs)
	}
	running := func() (string, string) {
		t.Helper()
		fields := strings.Fields(sh(t, "inspect", "-f", `{{.Id}} {{index .Config.Labels "`+sourceLabel+`"}} {{.State.Running}} {{.HostConfig.RestartPolicy.Name}}`, name))
		if len(fields) != 4 || fields[2] != "true" || fields[3] != "unless-stopped" {
			t.Fatalf("the updater is not running as compose ran it: %v", fields)
		}
		return fields[0], fields[1]
	}

	// A newer updater replaces this one, keeping its settings; the old container is gone.
	replace(edge("two"))
	newID, source := running()
	if newID == id || source != "two" {
		t.Fatalf("still the old updater: %s from %s", newID, source)
	}
	if exec.Command("docker", "inspect", name+previousSuffix).Run() == nil {
		t.Fatal("the replaced updater was kept")
	}
	if strings.Contains(sh(t, "inspect", "-f", "{{range .Mounts}}{{.Destination}} {{end}}", name), "/var/run/docker.sock") == false {
		t.Fatal("the new updater lost the Docker socket")
	}

	// One that never checks is rolled back: the previous updater is running again, told why.
	replace(edge("broken"))
	backID, source := running()
	if backID != newID || source != "two" {
		t.Fatalf("not rolled back: %s from %s", backID, source)
	}
	for i := 0; i < 40; i++ {
		if data, err := os.ReadFile(filepath.Join(status, "history.jsonl")); err == nil && strings.Contains(string(data), `"step":"updater"`) {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
	t.Fatal("the restored updater did not record the failed replacement")
}
