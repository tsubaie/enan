package updater

import (
	"reflect"
	"testing"
	"time"

	"github.com/tsubaie/enan/updater/internal/docker"
)

func TestRecreationKeepsTheOperatorsSettingsOnly(t *testing.T) {
	old := docker.Container{
		ID: "abcdef123456789",
		Config: map[string]any{
			"Image":       "ghcr.io/x/enan:latest",
			"Hostname":    "abcdef123456",
			"Env":         []any{"PATH=/usr/bin", "ENAN_REVISION=old", "SESSION_SECRET=s"},
			"Cmd":         []any{"node", "server.js"},
			"User":        "1001",
			"Healthcheck": map[string]any{"Test": []any{"CMD", "node", "-e", "compose"}},
			"Labels": map[string]any{
				"com.docker.compose.service":       "app",
				"org.opencontainers.image.version": "1.0.0",
			},
		},
		HostConfig: map[string]any{"Binds": []any{"data:/var/lib/enan/data"}},
	}
	old.NetworkSettings.Networks = map[string]docker.Endpoint{
		"enan_default": {Aliases: []string{"app", "abcdef123456"}, IPAddress: "172.18.0.2"},
	}
	image := docker.Image{Config: map[string]any{
		"Env":    []any{"PATH=/usr/bin", "ENAN_REVISION=old"},
		"Cmd":    []any{"node", "server.js"},
		"User":   "1001",
		"Labels": map[string]any{"org.opencontainers.image.version": "1.0.0"},
	}}
	spec := Recreation(old, image, "ghcr.io/x/enan:latest")
	if got := spec.Config["Env"]; !reflect.DeepEqual(got, []string{"SESSION_SECRET=s"}) {
		t.Fatalf("env %v", got)
	}
	for _, key := range []string{"Cmd", "User", "Hostname"} {
		if _, ok := spec.Config[key]; ok {
			t.Fatalf("%s came from the old image or Docker and was kept", key)
		}
	}
	if spec.Config["Healthcheck"] == nil {
		t.Fatal("the health check compose set was dropped")
	}
	if got := spec.Config["Labels"]; !reflect.DeepEqual(got, map[string]any{"com.docker.compose.service": "app"}) {
		t.Fatalf("labels %v", got)
	}
	endpoint := spec.Endpoints["enan_default"].(map[string]any)
	if !reflect.DeepEqual(endpoint["Aliases"], []string{"app"}) {
		t.Fatalf("aliases %v", endpoint["Aliases"])
	}
	if !reflect.DeepEqual(spec.HostConfig, old.HostConfig) {
		t.Fatal("host configuration changed")
	}
}

func TestWindow(t *testing.T) {
	riyadh, _ := time.LoadLocation("Asia/Riyadh")
	night, err := ParseWindow("23:00-05:00", riyadh)
	if err != nil {
		t.Fatal(err)
	}
	at := func(hour int) time.Time { return time.Date(2026, 10, 22, hour, 30, 0, 0, riyadh) }
	for hour, want := range map[int]bool{23: true, 2: true, 5: false, 12: false} {
		if night.Contains(at(hour)) != want {
			t.Fatalf("%02d:30 in 23:00-05:00: want %v", hour, want)
		}
	}
	for _, bad := range []string{"2-5", "02:00", "05:00-05:00", "25:00-01:00"} {
		if _, err := ParseWindow(bad, time.UTC); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
	var none *Window
	if !none.Contains(time.Now()) {
		t.Fatal("no window must mean always")
	}
}

func TestLoad(t *testing.T) {
	env := map[string]string{"ENAN_UPDATE_INTERVAL": "1h", "ENAN_UPDATE_WINDOW": "02:00-04:00", "ENAN_UPDATE_TZ": "Asia/Riyadh", "ENAN_ALLOW_MAJOR": "true"}
	config, err := Load(func(key string) string { return env[key] })
	if err != nil {
		t.Fatal(err)
	}
	if config.Interval != time.Hour || !config.AllowMajor || config.Window == nil || config.Socket != "/var/run/docker.sock" || config.Service != "app" {
		t.Fatalf("%+v", config)
	}
	for key, value := range map[string]string{"ENAN_UPDATE_INTERVAL": "10s", "ENAN_ALLOW_MAJOR": "maybe", "DOCKER_HOST": "tcp://docker:2375", "ENAN_UPDATE_TZ": "Mars/Base"} {
		bad := map[string]string{key: value}
		if key == "ENAN_UPDATE_TZ" {
			bad["ENAN_UPDATE_WINDOW"] = "02:00-04:00"
		}
		if _, err := Load(func(k string) string { return bad[k] }); err == nil {
			t.Fatalf("%s=%s accepted", key, value)
		}
	}
}

func TestMajor(t *testing.T) {
	for version, want := range map[string]int{"1.2.3": 1, "0.4.0": 0, "": -1, "x": -1, "12.0.0-rc.1": 12} {
		if got := major(version); got != want {
			t.Fatalf("major(%q) = %d, want %d", version, got, want)
		}
	}
}
