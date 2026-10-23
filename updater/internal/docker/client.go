// Package docker is the small part of the Docker Engine API the updater uses, over the Unix
// socket, with the standard library only.
package docker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Version is the Engine API version requested; 1.44 (Docker 25) creates a container on several
// networks at once.
const Version = "v1.44"

type Client struct {
	http *http.Client
}

// Deadlines for a call the daemon does not answer: without one the updater would wait forever, with
// no checks, no status and no alerts. A pull and a command run in the app (the backup) get longer.
var (
	callTimeout = 2 * time.Minute
	longTimeout = 30 * time.Minute
)

// cancelOnClose ends a call's deadline when its body is closed, after the caller has read it.
type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (b cancelOnClose) Close() error {
	defer b.cancel()
	return b.ReadCloser.Close()
}

// ErrNotFound is returned for a container or image the daemon does not know.
var ErrNotFound = errors.New("not found")

func New(socket string) *Client {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		},
	}
	return &Client{http: &http.Client{Transport: transport}}
}

func (c *Client) do(ctx context.Context, method, path string, query url.Values, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	target := "http://docker/" + Version + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	cancel := context.CancelFunc(func() {})
	if _, ok := ctx.Deadline(); !ok {
		ctx, cancel = context.WithTimeout(ctx, callTimeout)
	}
	request, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		cancel()
		return nil, err
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.Do(request)
	if err != nil {
		cancel()
		return nil, err
	}
	response.Body = cancelOnClose{response.Body, cancel}
	if response.StatusCode == http.StatusNotFound {
		response.Body.Close()
		return nil, fmt.Errorf("%s %s: %w", method, path, ErrNotFound)
	}
	if response.StatusCode >= 300 && response.StatusCode != http.StatusNotModified {
		defer response.Body.Close()
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("%s %s: %s: %s", method, path, response.Status, strings.TrimSpace(string(message)))
	}
	return response, nil
}

func (c *Client) json(ctx context.Context, method, path string, query url.Values, body, out any) error {
	response, err := c.do(ctx, method, path, query, body)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if out == nil {
		_, err = io.Copy(io.Discard, response.Body)
		return err
	}
	return json.NewDecoder(response.Body).Decode(out)
}

// Container is what the updater reads from an inspect. Config and HostConfig are kept as raw maps,
// so a recreated container carries every setting, including ones this package does not know.
type Container struct {
	ID              string         `json:"Id"`
	Name            string         `json:"Name"`
	Image           string         `json:"Image"`
	State           ContainerState `json:"State"`
	Config          map[string]any `json:"Config"`
	HostConfig      map[string]any `json:"HostConfig"`
	NetworkSettings struct {
		Networks map[string]Endpoint `json:"Networks"`
	} `json:"NetworkSettings"`
}

type ContainerState struct {
	Running bool `json:"Running"`
	Health  *struct {
		Status string `json:"Status"`
	} `json:"Health"`
}

type Endpoint struct {
	Aliases    []string          `json:"Aliases"`
	IPAMConfig map[string]any    `json:"IPAMConfig"`
	Links      []string          `json:"Links"`
	DriverOpts map[string]string `json:"DriverOpts"`
	IPAddress  string            `json:"IPAddress"`
}

// Labels of the container's own configuration.
func (c Container) Labels() map[string]string {
	labels := map[string]string{}
	if raw, ok := c.Config["Labels"].(map[string]any); ok {
		for key, value := range raw {
			if text, ok := value.(string); ok {
				labels[key] = text
			}
		}
	}
	return labels
}

// Ref is the image reference the container was created from, for example ghcr.io/x/enan:latest.
func (c Container) Ref() string {
	ref, _ := c.Config["Image"].(string)
	return ref
}

func (c *Client) InspectContainer(ctx context.Context, id string) (Container, error) {
	var container Container
	err := c.json(ctx, http.MethodGet, "/containers/"+url.PathEscape(id)+"/json", nil, nil, &container)
	container.Name = strings.TrimPrefix(container.Name, "/")
	return container, err
}

// ListContainers returns the ids of containers, stopped ones included, carrying every label.
func (c *Client) ListContainers(ctx context.Context, labels map[string]string) ([]string, error) {
	var filter []string
	for key, value := range labels {
		filter = append(filter, key+"="+value)
	}
	filters, _ := json.Marshal(map[string][]string{"label": filter})
	var rows []struct {
		ID string `json:"Id"`
	}
	query := url.Values{"all": {"1"}, "filters": {string(filters)}}
	if err := c.json(ctx, http.MethodGet, "/containers/json", query, nil, &rows); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids, nil
}

type Image struct {
	ID          string         `json:"Id"`
	RepoTags    []string       `json:"RepoTags"`
	RepoDigests []string       `json:"RepoDigests"`
	Config      map[string]any `json:"Config"`
	OS          string         `json:"Os"`
	Arch        string         `json:"Architecture"`
}

// Platform is os/architecture, such as linux/amd64, or "" when the daemon did not say.
func (i Image) Platform() string {
	if i.OS == "" || i.Arch == "" {
		return ""
	}
	return i.OS + "/" + i.Arch
}

func (i Image) Labels() map[string]string {
	labels := map[string]string{}
	if raw, ok := i.Config["Labels"].(map[string]any); ok {
		for key, value := range raw {
			if text, ok := value.(string); ok {
				labels[key] = text
			}
		}
	}
	return labels
}

// PlatformManifest returns the digest of the image manifest an image runs from, for the daemon's
// platform, as the containerd image store keeps it (API 1.48). It returns "" when the daemon does
// not report manifests (the classic store, or an older Docker).
func (c *Client) PlatformManifest(ctx context.Context, ref string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker/v1.48/images/"+ref+"/json?manifests=1", nil)
	if err != nil {
		return "", err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", nil
	}
	var image struct {
		Manifests []struct {
			Kind       string `json:"Kind"`
			Available  bool   `json:"Available"`
			Descriptor struct {
				Digest string `json:"digest"`
			} `json:"Descriptor"`
			ImageData struct {
				Platform struct {
					Architecture string `json:"architecture"`
				} `json:"Platform"`
			} `json:"ImageData"`
		} `json:"Manifests"`
	}
	if err := json.NewDecoder(response.Body).Decode(&image); err != nil {
		return "", err
	}
	digest := ""
	for _, manifest := range image.Manifests {
		if manifest.Kind != "image" || !manifest.Available {
			continue
		}
		if digest != "" {
			// Several platforms are present; the label cannot be told apart reliably.
			return "", nil
		}
		digest = manifest.Descriptor.Digest
	}
	return digest, nil
}

func (c *Client) InspectImage(ctx context.Context, ref string) (Image, error) {
	var image Image
	err := c.json(ctx, http.MethodGet, "/images/"+ref+"/json", nil, nil, &image)
	return image, err
}

// Pull fetches repository@digest. The daemon streams progress; an error can arrive in that stream
// after a 200, so the whole stream is read.
// Pull downloads repository@digest for platform (os/arch; "" is the daemon's own). An install on
// an emulated platform, such as linux/amd64 on an ARM Mac, must name it or the pull is refused.
func (c *Client) Pull(ctx context.Context, repository, digest, platform string) error {
	ctx, cancel := context.WithTimeout(ctx, longTimeout)
	defer cancel()
	query := url.Values{"fromImage": {repository}, "tag": {digest}}
	if platform != "" {
		query.Set("platform", platform)
	}
	response, err := c.do(ctx, http.MethodPost, "/images/create", query, nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	decoder := json.NewDecoder(response.Body)
	for {
		var message struct {
			Error string `json:"error"`
		}
		if err := decoder.Decode(&message); errors.Is(err, io.EOF) {
			return nil
		} else if err != nil {
			return err
		}
		if message.Error != "" {
			return fmt.Errorf("pull %s@%s: %s", repository, digest, message.Error)
		}
	}
}

// Tag points repository:tag at an image.
func (c *Client) Tag(ctx context.Context, image, repository, tag string) error {
	return c.json(ctx, http.MethodPost, "/images/"+image+"/tag", url.Values{"repo": {repository}, "tag": {tag}}, nil, nil)
}

// ImagesOf lists the ids of images whose reference is in repository.
func (c *Client) ImagesOf(ctx context.Context, repository string) ([]string, error) {
	filters, _ := json.Marshal(map[string][]string{"reference": {repository}})
	var rows []struct {
		ID string `json:"Id"`
	}
	if err := c.json(ctx, http.MethodGet, "/images/json", url.Values{"filters": {string(filters)}}, nil, &rows); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	return ids, nil
}

func (c *Client) RemoveImage(ctx context.Context, id string) error {
	return c.json(ctx, http.MethodDelete, "/images/"+id, url.Values{"noprune": {"0"}}, nil, nil)
}

// Create makes a container. config is the container configuration; hostConfig and endpoints are
// added to it as the API expects.
func (c *Client) Create(ctx context.Context, name string, config, hostConfig map[string]any, endpoints map[string]any) (string, error) {
	body := map[string]any{}
	for key, value := range config {
		body[key] = value
	}
	body["HostConfig"] = hostConfig
	body["NetworkingConfig"] = map[string]any{"EndpointsConfig": endpoints}
	var created struct {
		ID string `json:"Id"`
	}
	err := c.json(ctx, http.MethodPost, "/containers/create", url.Values{"name": {name}}, body, &created)
	return created.ID, err
}

func (c *Client) Start(ctx context.Context, id string) error {
	return c.json(ctx, http.MethodPost, "/containers/"+id+"/start", nil, nil, nil)
}

func (c *Client) Stop(ctx context.Context, id string, timeout time.Duration) error {
	// The daemon waits up to timeout for the app to exit before it answers.
	ctx, cancel := context.WithTimeout(ctx, timeout+callTimeout)
	defer cancel()
	return c.json(ctx, http.MethodPost, "/containers/"+id+"/stop", url.Values{"t": {fmt.Sprint(int(timeout.Seconds()))}}, nil, nil)
}

func (c *Client) Rename(ctx context.Context, id, name string) error {
	return c.json(ctx, http.MethodPost, "/containers/"+id+"/rename", url.Values{"name": {name}}, nil, nil)
}

func (c *Client) Remove(ctx context.Context, id string) error {
	return c.json(ctx, http.MethodDelete, "/containers/"+id, url.Values{"force": {"1"}}, nil, nil)
}

// Exec runs a command in a running container and returns its exit code and combined output.
func (c *Client) Exec(ctx context.Context, id string, command []string) (int, string, error) {
	ctx, cancel := context.WithTimeout(ctx, longTimeout)
	defer cancel()
	var created struct {
		ID string `json:"Id"`
	}
	request := map[string]any{"Cmd": command, "AttachStdout": true, "AttachStderr": true}
	if err := c.json(ctx, http.MethodPost, "/containers/"+id+"/exec", nil, request, &created); err != nil {
		return 0, "", err
	}
	response, err := c.do(ctx, http.MethodPost, "/exec/"+created.ID+"/start", nil, map[string]any{"Detach": false})
	if err != nil {
		return 0, "", err
	}
	output, err := demux(response.Body)
	response.Body.Close()
	if err != nil {
		return 0, output, err
	}
	var inspected struct {
		ExitCode int `json:"ExitCode"`
	}
	err = c.json(ctx, http.MethodGet, "/exec/"+created.ID+"/json", nil, nil, &inspected)
	return inspected.ExitCode, output, err
}

// Logs returns the last lines a container wrote.
func (c *Client) Logs(ctx context.Context, id string, lines int) (string, error) {
	response, err := c.do(ctx, http.MethodGet, "/containers/"+id+"/logs", url.Values{"stdout": {"1"}, "stderr": {"1"}, "tail": {fmt.Sprint(lines)}}, nil)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	return demux(response.Body)
}

// demux joins Docker's multiplexed stdout/stderr frames (an 8-byte header, then the payload). A
// container started with a TTY sends a plain stream, which is returned as it is.
func demux(body io.Reader) (string, error) {
	reader := bufio.NewReader(body)
	head, err := reader.Peek(8)
	if err != nil || head[0] > 2 || head[1] != 0 || head[2] != 0 || head[3] != 0 {
		rest, readErr := io.ReadAll(reader)
		if readErr != nil {
			return string(rest), readErr
		}
		return string(rest), nil
	}
	var out strings.Builder
	header := make([]byte, 8)
	for {
		if _, err := io.ReadFull(reader, header); errors.Is(err, io.EOF) {
			return out.String(), nil
		} else if err != nil {
			return out.String(), err
		}
		size := binary.BigEndian.Uint32(header[4:])
		if _, err := io.CopyN(&out, reader, int64(size)); err != nil {
			return out.String(), err
		}
	}
}
