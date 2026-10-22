package updater

import (
	"reflect"
	"slices"
	"strings"

	"github.com/tsubaie/enan/updater/internal/docker"
)

// imageDefaults are the container settings an image supplies. A container inspect shows them
// merged with what compose set, so a value equal to the old image's own came from the image and is
// dropped: the new image then supplies its own.
var imageDefaults = []string{"Cmd", "Entrypoint", "WorkingDir", "User", "ExposedPorts", "Volumes", "StopSignal", "Healthcheck", "Shell", "OnBuild"}

// Spec is everything needed to create a container like another one.
type Spec struct {
	Config     map[string]any
	HostConfig map[string]any
	Endpoints  map[string]any
}

// Recreation copies a container's configuration for a new image, keeping every setting the
// operator or compose gave it and none the old image gave it. ref is the reference the new
// container names (the one compose uses, now tagged to the new image).
func Recreation(old docker.Container, oldImage docker.Image, ref string) Spec {
	config := map[string]any{}
	for key, value := range old.Config {
		config[key] = value
	}
	for _, key := range imageDefaults {
		if value, ok := config[key]; ok && reflect.DeepEqual(value, oldImage.Config[key]) {
			delete(config, key)
		}
	}
	config["Env"] = without(asStrings(config["Env"]), asStrings(oldImage.Config["Env"]))
	labels := map[string]any{}
	imageLabels := oldImage.Labels()
	for key, value := range old.Labels() {
		if imageValue, fromImage := imageLabels[key]; !fromImage || imageValue != value {
			labels[key] = value
		}
	}
	config["Labels"] = labels
	config["Image"] = ref
	// Docker names a container's host after its id unless told otherwise.
	if hostname, _ := config["Hostname"].(string); hostname != "" && strings.HasPrefix(old.ID, hostname) {
		delete(config, "Hostname")
	}
	endpoints := map[string]any{}
	for network, endpoint := range old.NetworkSettings.Networks {
		// The container's own short id is an alias Docker adds by itself.
		aliases := slices.DeleteFunc(slices.Clone(endpoint.Aliases), func(alias string) bool {
			return strings.HasPrefix(old.ID, alias)
		})
		endpoints[network] = map[string]any{
			"Aliases":    aliases,
			"IPAMConfig": endpoint.IPAMConfig,
			"Links":      endpoint.Links,
			"DriverOpts": endpoint.DriverOpts,
		}
	}
	return Spec{Config: config, HostConfig: old.HostConfig, Endpoints: endpoints}
}

func asStrings(value any) []string {
	items, _ := value.([]any)
	strings := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			strings = append(strings, text)
		}
	}
	return strings
}

// without returns the entries of list that are not in remove.
func without(list, remove []string) []string {
	kept := []string{}
	for _, entry := range list {
		if !slices.Contains(remove, entry) {
			kept = append(kept, entry)
		}
	}
	return kept
}
