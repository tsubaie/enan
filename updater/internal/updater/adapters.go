package updater

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/tsubaie/enan/updater/internal/docker"
)

// HTTPProber reads /api/v1/health from the container's address on a network the updater shares
// with it (compose's default network, or any other).
type HTTPProber struct {
	Port   int
	Client *http.Client
}

func (p HTTPProber) Probe(ctx context.Context, container docker.Container) (Health, error) {
	var health Health
	last := errors.New("the container has no network address")
	for _, endpoint := range container.NetworkSettings.Networks {
		if endpoint.IPAddress == "" {
			continue
		}
		target := "http://" + net.JoinHostPort(endpoint.IPAddress, strconv.Itoa(p.Port)) + "/api/v1/health"
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			return health, err
		}
		response, err := p.Client.Do(request)
		if err != nil {
			last = err
			continue
		}
		err = json.NewDecoder(response.Body).Decode(&health)
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			last = fmt.Errorf("/api/v1/health answered %s", response.Status)
			continue
		}
		if err != nil {
			last = fmt.Errorf("/api/v1/health: %w", err)
			continue
		}
		return health, nil
	}
	return health, last
}

// Webhook posts each alert as JSON (README § Automatic updates), retrying twice.
type Webhook struct {
	URL    string
	Client *http.Client
}

// Alert is the webhook's body. `text` is a one-line summary for chat services that show it as is.
type Alert struct {
	Event  string `json:"event"`
	Host   string `json:"host"`
	Text   string `json:"text"`
	Status Status `json:"status"`
}

func Summary(event string, status Status) string {
	version := func(image *Image) string {
		if image == nil {
			return "unknown"
		}
		return versionOf(image)
	}
	switch event {
	case Updated:
		return fmt.Sprintf("Enan updated to %s.", version(status.Running))
	case RolledBack:
		return fmt.Sprintf("Enan update to %s failed at %s and was rolled back to %s: %s", version(status.Candidate), status.Step, version(status.Running), status.Error)
	case RollbackFailed:
		return fmt.Sprintf("Enan update to %s failed and the rollback failed too; the app may be down: %s", version(status.Candidate), status.Error)
	case Blocked:
		return fmt.Sprintf("Enan update to %s is waiting: %s", version(status.Candidate), status.Error)
	case Failed:
		return fmt.Sprintf("Enan update check failed at %s: %s", status.Step, status.Error)
	case "updater_update_available":
		return "A new version of the Enan updater is available; pull and restart the updater service."
	}
	return "Enan updater: " + event
}

func (w Webhook) Notify(ctx context.Context, event string, status Status) error {
	if w.URL == "" {
		return nil
	}
	host, _ := os.Hostname()
	body, err := json.Marshal(Alert{Event: event, Host: host, Text: Summary(event, status), Status: status})
	if err != nil {
		return err
	}
	var last error
	for attempt, wait := 0, 2*time.Second; attempt < 3; attempt, wait = attempt+1, wait*2 {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
			}
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
		if err != nil {
			return err
		}
		request.Header.Set("Content-Type", "application/json")
		response, err := w.Client.Do(request)
		if err != nil {
			last = err
			continue
		}
		response.Body.Close()
		if response.StatusCode < 300 {
			return nil
		}
		last = fmt.Errorf("webhook answered %s", response.Status)
	}
	return last
}
