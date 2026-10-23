// Command enan-updater announces new images of an Enan install's channel and installs one when an
// administrator asks, or allows it (ADR 0051, ADR 0057). Install now and the automatic setting are
// sent from Administration → Updates.
//
//	enan-updater run          check every interval and act on commands (the container's command)
//	enan-updater status       print status.json
//	enan-updater history      print the last outcomes
//	enan-updater check        check now
//	enan-updater pause|resume stop or restart checking and installing
//	enan-updater retry        allow images that failed before to be tried again
//	enan-updater rollback [--force]
//	                          go back to the image the last update replaced
//	enan-updater healthcheck  exit 1 when the updater has stopped checking (Docker HEALTHCHECK)
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
	_ "time/tzdata" // ENAN_UPDATE_TZ, in an image with no zoneinfo

	"github.com/tsubaie/enan/updater/internal/docker"
	"github.com/tsubaie/enan/updater/internal/registry"
	"github.com/tsubaie/enan/updater/internal/updater"
)

func main() {
	command := "run"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	config, err := updater.Load(updater.Getenv)
	if err != nil {
		fail(err)
	}
	switch command {
	case "run":
		run(config)
	case "status":
		show(filepath.Join(config.StatusDir, "status.json"))
	case "history":
		show(filepath.Join(config.StatusDir, "history.jsonl"))
	case "healthcheck":
		healthcheck(config)
	case "check", "pause", "resume", "retry", "rollback":
		force := len(os.Args) > 2 && os.Args[2] == "--force"
		queue(config, updater.Command{Command: command, Force: force})
	default:
		fail(fmt.Errorf("unknown command %q; see the comment at the top of main.go or README § Automatic updates", command))
	}
}

func run(config updater.Config) {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	self, _ := os.Hostname()
	u := &updater.Updater{
		Config:   config,
		Engine:   docker.New(config.Socket),
		Registry: registry.New(config.Insecure),
		Prober:   updater.HTTPProber{Port: config.AppPort, Client: &http.Client{Timeout: 5 * time.Second}},
		Notifier: updater.Webhook{URL: config.Webhook, Client: &http.Client{Timeout: 15 * time.Second}},
		Log:      log,
		Self:     self,
	}
	closeLock, err := u.Open()
	if err != nil {
		fail(err)
	}
	defer closeLock()
	if err := os.WriteFile(filepath.Join(config.StatusDir, "started"), []byte(time.Now().UTC().Format(time.RFC3339)), 0o644); err != nil {
		fail(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	log.Info("started", "interval", config.Interval.String(), "channel", config.Channel)
	if err := u.Run(ctx); err != nil {
		fail(err)
	}
}

func show(path string) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		fail(fmt.Errorf("%s does not exist yet: the updater has not run", path))
	}
	if err != nil {
		fail(err)
	}
	os.Stdout.Write(data)
}

// queue leaves a command for the running updater, which picks it up within ENAN_COMMAND_POLL.
func queue(config updater.Config, command updater.Command) {
	data, _ := json.Marshal(command)
	name := filepath.Join(config.CommandsDir, strconv.FormatInt(time.Now().UnixNano(), 10)+".json")
	if err := os.WriteFile(name+".tmp", data, 0o644); err != nil {
		fail(err)
	}
	if err := os.Rename(name+".tmp", name); err != nil {
		fail(err)
	}
	fmt.Printf("queued %s; the updater acts on it within %s (see `enan-updater status`)\n", command.Command, config.Poll)
}

// healthcheck fails when the last check is older than three intervals, which also covers an
// updater that cannot reach the registry or Docker.
func healthcheck(config updater.Config) {
	limit := 3*config.Interval + 5*time.Minute
	var status updater.Status
	if data, err := os.ReadFile(filepath.Join(config.StatusDir, "status.json")); err == nil {
		_ = json.Unmarshal(data, &status)
	}
	last := status.LastCheckAt
	if last.IsZero() {
		if data, err := os.ReadFile(filepath.Join(config.StatusDir, "started")); err == nil {
			last, _ = time.Parse(time.RFC3339, string(data))
		}
	}
	if last.IsZero() || time.Since(last) > limit {
		fmt.Printf("no check since %s\n", last.Format(time.RFC3339))
		os.Exit(1)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "enan-updater:", err)
	os.Exit(1)
}
