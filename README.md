# Mathesar Update Companion

This docker image provides an HTTP API to trigger and track automated Mathesar updates. It's based on the [Wiki.js Update Companion](https://github.com/Requarks/wiki-update-companion).

## Technical Reference

The mathesar-update-companion container exposes a small HTTP API to the main Mathesar container *(and only the container, not to the host)*.

By sending a POST request to `http://mathesar-update-companion/start`, the following actions are taken:

1. Stop and remove the `mathesar_service` container
1. Pull the latest Mathesar image
1. Recreate the `mathesar_service` container using the same settings as the previous container

The major version to use for the upgrade can be specified by adding it to the URL, e.g.:
```
http://mathesar-update-companion/upgrade/3
```
The default is `1` if not provided.

For security reasons, this mechanism is not part of the main Mathesar docker image, because it would require the Docker socket to be mapped into the container. A compromised Mathesar instance would effectively give full access to other containers on the host. By using a separate isolated container, which only exposes a single HTTP endpoint internally, this potential security risk is eliminated.

The mathesar-update-companion container must:

- Have the hostname `mathesar-update-companion`
- Be on the same network as the `mathesar_service` container
- Have the host `/var/run/docker.sock` socket mapped to the container in the same location
