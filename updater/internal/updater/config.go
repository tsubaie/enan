package updater

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is read from the environment once, at start (README § Automatic updates).
type Config struct {
	Socket        string
	StatusDir     string
	CommandsDir   string
	Channel       string // a tag of the app's repository; empty follows the tag the app was created with
	Interval      time.Duration
	Window        *Window
	HealthTimeout time.Duration
	StopTimeout   time.Duration
	Webhook       string
	AllowContract bool
	Project       string // compose project of the app; empty means this container's own project
	Service       string // compose service of the app
	Container     string // or the app's container name, outside compose
	AppPort       int
	BackupCommand []string
	BackupDir     string
	Insecure      []string
	Poll          time.Duration
}

func Load(env func(string) string) (Config, error) {
	get := func(key, fallback string) string {
		if value := strings.TrimSpace(env(key)); value != "" {
			return value
		}
		return fallback
	}
	config := Config{
		Socket:        strings.TrimPrefix(get("DOCKER_HOST", "unix:///var/run/docker.sock"), "unix://"),
		StatusDir:     get("ENAN_STATUS_DIR", "/var/lib/enan-updater/status"),
		CommandsDir:   get("ENAN_COMMANDS_DIR", "/var/lib/enan-updater/commands"),
		Channel:       get("ENAN_CHANNEL", ""),
		Webhook:       get("ENAN_ALERT_WEBHOOK", ""),
		Project:       get("ENAN_PROJECT", get("COMPOSE_PROJECT_NAME", "")),
		Service:       get("ENAN_APP_SERVICE", "app"),
		Container:     get("ENAN_APP_CONTAINER", ""),
		BackupCommand: strings.Fields(get("ENAN_BACKUP_COMMAND", "pnpm backup:create")),
		BackupDir:     get("ENAN_BACKUP_DIR", "/var/lib/enan/backups"),
		Insecure:      strings.Split(get("ENAN_INSECURE_REGISTRIES", ""), ","),
	}
	if strings.Contains(config.Socket, "://") {
		return config, fmt.Errorf("DOCKER_HOST must be a unix socket, got %s", config.Socket)
	}
	var err error
	durations := []struct {
		key, fallback string
		into          *time.Duration
	}{
		{"ENAN_UPDATE_INTERVAL", "15m", &config.Interval},
		{"ENAN_HEALTH_TIMEOUT", "3m", &config.HealthTimeout},
		{"ENAN_STOP_TIMEOUT", "35s", &config.StopTimeout},
		{"ENAN_COMMAND_POLL", "30s", &config.Poll},
	}
	for _, d := range durations {
		if *d.into, err = time.ParseDuration(get(d.key, d.fallback)); err != nil || *d.into <= 0 {
			return config, fmt.Errorf("%s: %q is not a duration such as 15m", d.key, get(d.key, d.fallback))
		}
	}
	if config.Interval < time.Minute {
		return config, fmt.Errorf("ENAN_UPDATE_INTERVAL must be at least 1m")
	}
	if config.AppPort, err = strconv.Atoi(get("ENAN_APP_PORT", "3000")); err != nil {
		return config, fmt.Errorf("ENAN_APP_PORT: %w", err)
	}
	for key, into := range map[string]*bool{"ENAN_ALLOW_CONTRACT": &config.AllowContract} {
		if *into, err = strconv.ParseBool(get(key, "false")); err != nil {
			return config, fmt.Errorf("%s: %q is not true or false", key, env(key))
		}
	}
	if window := get("ENAN_UPDATE_WINDOW", ""); window != "" {
		zone, err := time.LoadLocation(get("ENAN_UPDATE_TZ", "UTC"))
		if err != nil {
			return config, fmt.Errorf("ENAN_UPDATE_TZ: %w", err)
		}
		if config.Window, err = ParseWindow(window, zone); err != nil {
			return config, err
		}
	}
	if len(config.BackupCommand) == 0 {
		return config, fmt.Errorf("ENAN_BACKUP_COMMAND is empty")
	}
	return config, nil
}

// Window is a daily span such as 02:00-05:00 in a time zone; it may cross midnight.
type Window struct {
	From, To int // minutes after midnight
	Zone     *time.Location
}

func ParseWindow(text string, zone *time.Location) (*Window, error) {
	from, to, ok := strings.Cut(text, "-")
	start, err1 := clock(from)
	end, err2 := clock(to)
	if !ok || err1 != nil || err2 != nil || start == end {
		return nil, fmt.Errorf("ENAN_UPDATE_WINDOW: %q is not a span such as 02:00-05:00", text)
	}
	return &Window{From: start, To: end, Zone: zone}, nil
}

func clock(text string) (int, error) {
	parsed, err := time.Parse("15:04", strings.TrimSpace(text))
	if err != nil {
		return 0, err
	}
	return parsed.Hour()*60 + parsed.Minute(), nil
}

// Contains reports whether t falls inside the window.
func (w *Window) Contains(t time.Time) bool {
	if w == nil {
		return true
	}
	local := t.In(w.Zone)
	minute := local.Hour()*60 + local.Minute()
	if w.From < w.To {
		return minute >= w.From && minute < w.To
	}
	return minute >= w.From || minute < w.To
}

// Getenv adapts os.Getenv for Load.
func Getenv(key string) string { return os.Getenv(key) }
