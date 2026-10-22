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

// Image identifies an app image by what its labels and the registry say about it.
type Image struct {
	Digest   string `json:"digest,omitempty"`
	ID       string `json:"id,omitempty"`
	Version  string `json:"version,omitempty"`
	Revision string `json:"revision,omitempty"`
	Schema   int    `json:"schema"`
	Contract int    `json:"contract"`
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
	Phase    Phase  `json:"phase"`
	Paused   bool   `json:"paused"`
	Target   *Image `json:"target,omitempty"`
	Previous *Image `json:"previous,omitempty"`
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
	UpdaterUpdate  string    `json:"updaterUpdate,omitempty"`
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
