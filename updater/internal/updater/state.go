package updater

import (
	"bufio"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Protocol is what this updater understands of Enan's requests and status, raised whenever Enan
// starts relying on something new: 1 is announce mode, Install now and the automatic setting
// (ADR 0057) and acting on events (ADR 0059); 2 is replacing itself (ADR 0062). Enan warns when the updater's is older than it needs
// (ADR 0060); an updater from before this field writes none, which reads as 0.
const Protocol = 2

// Image identifies an app image by what its labels and the registry say about it.
type Image struct {
	Digest   string `json:"digest,omitempty"`
	ID       string `json:"id,omitempty"`
	Version  string `json:"version,omitempty"`
	Revision string `json:"revision,omitempty"`
	Schema   int    `json:"schema"`
	Contract int    `json:"contract"`
	// os/arch the image is for; a candidate is read and pulled for the running image's platform.
	Platform string `json:"platform,omitempty"`
}

// Phase is where an update stands. Anything but idle at start means the process stopped during
// an update, and recovery finishes or reverses it.
type Phase string

const (
	Idle      Phase = "idle"
	Switching Phase = "switching" // the previous container is renamed and stopped, or about to be
	Verifying Phase = "verifying" // the new container exists and is being checked
)

// State is the updater's own memory, written after every transition.
type State struct {
	Phase  Phase `json:"phase"`
	Paused bool  `json:"paused"`
	// Install new releases without waiting for Install now, inside Window when it is set
	// (ADMIN-B68). Nil only in a state written before announce mode; Open settles it.
	Automatic *bool  `json:"automatic,omitempty"`
	Window    string `json:"window,omitempty"`
	Target    *Image `json:"target,omitempty"`
	Previous  *Image `json:"previous,omitempty"`
	// The container the update replaces, renamed to Name + previousSuffix until the new one is verified.
	PreviousContainer string `json:"previousContainer,omitempty"`
	Name              string `json:"name,omitempty"`
	Ref               string `json:"ref,omitempty"`
	Backup            string `json:"backup,omitempty"`
	// After an update succeeded: the image it replaced, for a manual rollback.
	LastPrevious *Image `json:"lastPrevious,omitempty"`
	// Candidates that failed and were rolled back; never retried until `enan-updater retry`.
	Rejected map[string]string `json:"rejected,omitempty"`
	// Alerts already sent, so a condition that persists alerts once.
	Alerted map[string]bool `json:"alerted,omitempty"`
}

const previousSuffix = "-enan-previous"

// Outcomes recorded in the status.
const (
	Checking       = "checking"
	Checked        = "checked"
	Updating       = "updating"
	Updated        = "updated"
	Failed         = "failed"
	RolledBack     = "rolled_back"
	RollbackFailed = "rollback_failed"
	Blocked        = "blocked"
	Paused         = "paused"
	Available      = "available" // announced, waiting for Install now (ADMIN-B67)
)

// Status is what operators and Enan read (status.json). It holds no secrets.
type Status struct {
	Channel        string    `json:"channel"`
	Running        *Image    `json:"running,omitempty"`
	Candidate      *Image    `json:"candidate,omitempty"`
	State          string    `json:"state"`
	Step           string    `json:"step,omitempty"`
	Error          string    `json:"error,omitempty"`
	Backup         string    `json:"backup,omitempty"`
	RestoreCommand string    `json:"restoreCommand,omitempty"`
	Log            string    `json:"log,omitempty"`
	StartedAt      time.Time `json:"startedAt,omitzero"`
	FinishedAt     time.Time `json:"finishedAt,omitzero"`
	LastCheckAt    time.Time `json:"lastCheckAt,omitzero"`
	Paused         bool      `json:"paused"`
	Automatic      bool      `json:"automatic"`
	Window         string    `json:"window,omitempty"`
	TimeZone       string    `json:"timeZone,omitempty"`
	// The candidate has a migration the running release cannot read: Install now must be confirmed.
	Confirm       bool   `json:"confirm,omitempty"`
	UpdaterUpdate string `json:"updaterUpdate,omitempty"`
	Protocol      int    `json:"protocol"`
	// How often the updater checks, so a reader can tell when it has stopped (ADMIN-B57).
	IntervalSeconds int `json:"intervalSeconds"`
}

type store struct{ dir string }

func (s store) path(name string) string { return filepath.Join(s.dir, name) }

// write replaces a file atomically, so a reader never sees half of it.
func (s store) write(name string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary := s.path("." + name + ".tmp")
	if err := os.WriteFile(temporary, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(temporary, s.path(name))
}

func (s store) read(name string, into any) error {
	data, err := os.ReadFile(s.path(name))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(data, into)
}

const historyLength = 50

// appendHistory keeps the last historyLength outcomes, one JSON object per line.
func (s store) appendHistory(status Status) error {
	var lines []string
	if file, err := os.Open(s.path("history.jsonl")); err == nil {
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			if line := strings.TrimSpace(scanner.Text()); line != "" {
				lines = append(lines, line)
			}
		}
		file.Close()
	}
	status.Log = "" // the excerpt stays in status.json; history is the outline
	entry, err := json.Marshal(status)
	if err != nil {
		return err
	}
	lines = append(lines, string(entry))
	if len(lines) > historyLength {
		lines = lines[len(lines)-historyLength:]
	}
	temporary := s.path(".history.jsonl.tmp")
	if err := os.WriteFile(temporary, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		return err
	}
	return os.Rename(temporary, s.path("history.jsonl"))
}
