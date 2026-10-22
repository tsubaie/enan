//go:build integration

package updater

// Runs the update cycle against a real Docker daemon and a local registry, with small busybox
// images that answer /api/v1/health the way Enan does. Needs Docker and network access to pull
// busybox and registry:2:
//
//	go test -tags integration -run Integration ./internal/updater

import (
	"context"
	"encoding/json"
	"fmt"
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

const (
	project      = "enanupdatertest"
	registryPort = "5055"
	registryHost = "localhost:" + registryPort
	appRef       = registryHost + "/enan:edge"
)

func sh(t *testing.T, args ...string) string {
	t.Helper()
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("docker %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

// stand-in builds an image that reports version and revision, or never becomes healthy.
func standIn(t *testing.T, dir, version string, healthy bool) string {
	t.Helper()
	context := filepath.Join(dir, version)
	os.MkdirAll(filepath.Join(context, "www/api/v1"), 0o755)
	if healthy {
		body := fmt.Sprintf(`{"status":"ok","version":%q,"revision":"rev-%s","db":true}`, version, version)
		os.WriteFile(filepath.Join(context, "www/api/v1/health"), []byte(body), 0o644)
	}
	// The backup command Enan's image provides, printing a manifest with an id.
	os.WriteFile(filepath.Join(context, "pnpm"), []byte("#!/bin/sh\nid=backup-$(date +%s%N)\nmkdir -p /backups/$id\necho \"{\\\"id\\\":\\\"$id\\\"}\"\n"), 0o755)
	dockerfile := fmt.Sprintf(`FROM busybox:1.37
COPY www /www
COPY pnpm /bin/pnpm
ENV ENAN_REVISION=rev-%[1]s
LABEL org.opencontainers.image.version=%[1]s org.opencontainers.image.revision=rev-%[1]s org.enan.schema=7 org.enan.contract=0
CMD ["httpd", "-f", "-p", "3000", "-h", "/www"]
`, version)
	os.WriteFile(filepath.Join(context, "Dockerfile"), []byte(dockerfile), 0o644)
	tag := registryHost + "/enan:" + version
	sh(t, "build", "-q", "-t", tag, context)
	sh(t, "push", "-q", tag)
	return tag
}

func publishEdge(t *testing.T, tag string) {
	t.Helper()
	sh(t, "tag", tag, appRef)
	sh(t, "push", "-q", appRef)
}

func TestIntegration(t *testing.T) {
	t.Run("ADMIN-B56 against Docker: install, keep settings, roll back, hold a major version", integrationCycle)
}

func integrationCycle(t *testing.T) {
	if _, err := exec.LookPath("docker"); err != nil {
		t.Skip("no docker")
	}
	cleanup := func() {
		exec.Command("docker", "rm", "-f", project+"-app-1", project+"-app-1"+previousSuffix, project+"-registry").Run()
		exec.Command("docker", "volume", "rm", "-f", project+"-data").Run()
		exec.Command("docker", "network", "rm", project+"_default").Run()
		out, _ := exec.Command("docker", "images", "-q", registryHost+"/enan").Output()
		for _, id := range strings.Fields(string(out)) {
			exec.Command("docker", "rmi", "-f", id).Run()
		}
	}
	cleanup()
	t.Cleanup(cleanup)
	sh(t, "run", "-d", "--name", project+"-registry", "-p", "127.0.0.1:"+registryPort+":5000", "registry:2")
	for i := 0; i < 50; i++ {
		if response, err := http.Get("http://" + registryHost + "/v2/"); err == nil {
			response.Body.Close()
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	dir := t.TempDir()
	v1 := standIn(t, dir, "1.0.0", true)
	v2 := standIn(t, dir, "1.1.0", true)
	v3 := standIn(t, dir, "1.2.0", false)
	v4 := standIn(t, dir, "2.0.0", true)
	publishEdge(t, v1)

	sh(t, "network", "create", project+"_default")
	sh(t, "run", "-d", "--name", project+"-app-1",
		"--network", project+"_default", "--network-alias", "app",
		"--label", "com.docker.compose.project="+project, "--label", "com.docker.compose.service=app",
		"--health-cmd", "wget -qO- http://127.0.0.1:3000/api/v1/health", "--health-interval", "1s",
		"--health-retries", "3", "--health-start-period", "1s",
		"-e", "SESSION_SECRET=kept", "-v", project+"-data:/var/lib/enan/data", "--restart", "unless-stopped",
		appRef)

	u := &Updater{
		Config: Config{
			StatusDir: filepath.Join(dir, "status"), CommandsDir: filepath.Join(dir, "commands"),
			Interval: time.Minute, HealthTimeout: 30 * time.Second, StopTimeout: 2 * time.Second,
			Project: project, Service: "app", AppPort: 3000,
			BackupCommand: []string{"pnpm", "backup:create"}, BackupDir: "/backups", Poll: time.Second,
		},
		Engine:   docker.New("/var/run/docker.sock"),
		Registry: registry.New([]string{registryHost}),
		Prober:   HTTPProber{Port: 3000, Client: &http.Client{Timeout: 2 * time.Second}},
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	closeLock, err := u.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer closeLock()
	ctx := context.Background()
	expect := func(state, version string) {
		t.Helper()
		if u.status.State != state {
			t.Fatalf("state %s, want %s: %s at %s\n%s", u.status.State, state, u.status.Error, u.status.Step, u.status.Log)
		}
		var health Health
		out := sh(t, "exec", project+"-app-1", "wget", "-qO-", "http://127.0.0.1:3000/api/v1/health")
		if err := json.Unmarshal([]byte(out), &health); err != nil || health.Version != version {
			t.Fatalf("the app answers %s, want version %s", out, version)
		}
	}

	// Wait for the first container to be healthy, as compose would have.
	for i := 0; i < 60 && !strings.Contains(sh(t, "inspect", "-f", "{{.State.Health.Status}}", project+"-app-1"), "healthy"); i++ {
		time.Sleep(500 * time.Millisecond)
	}

	u.Check(ctx)
	expect(Checked, "1.0.0")

	publishEdge(t, v2)
	u.Check(ctx)
	expect(Updated, "1.1.0")
	inspected := sh(t, "inspect", "-f", `{{range .Config.Env}}{{.}} {{end}}|{{range .Mounts}}{{.Name}}{{end}}|{{index .Config.Labels "com.docker.compose.project"}}|{{.HostConfig.RestartPolicy.Name}}`, project+"-app-1")
	for _, want := range []string{"SESSION_SECRET=kept", "ENAN_REVISION=rev-1.1.0", project + "-data", "|" + project + "|", "unless-stopped"} {
		if !strings.Contains(inspected, want) {
			t.Fatalf("the new container lost %q: %s", want, inspected)
		}
	}
	if strings.Contains(sh(t, "ps", "-a", "--format", "{{.Names}}"), previousSuffix) {
		t.Fatal("the replaced container was kept after a verified update")
	}

	publishEdge(t, v3)
	u.Check(ctx)
	expect(RolledBack, "1.1.0")
	if u.status.Step != "verify" || u.status.Backup == "" {
		t.Fatalf("step %s, backup %q", u.status.Step, u.status.Backup)
	}

	publishEdge(t, v4)
	u.Check(ctx)
	if u.status.State != Blocked || !strings.Contains(u.status.Error, "major") {
		t.Fatalf("state %s: %s", u.status.State, u.status.Error)
	}
}
