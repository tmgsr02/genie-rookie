# Nested Codex sandbox

`docker-default.json` is copied unchanged from https://github.com/moby/profiles at the commit in `upstream.commit`; its Apache-2.0 license is included as `LICENSE`.

`codex-userns.json` adds one allow rule for `clone`, `unshare`, `setns`, `mount`, `umount`, `umount2`, and `pivot_root`. These let Codex's bubblewrap sandbox establish inner user, mount, process and network namespaces. Docker's default profile otherwise prevents the worker from executing any command. The rest of the upstream allowlist and default-deny policy is retained.

This is applied only to the authoring container. It still runs as UID/GID 1000 with all container capabilities dropped, no-new-privileges, a read-only root filesystem, no host mounts, bounded temporary storage/processes/memory/CPU, and a job deadline. Kernel permission checks continue to apply: an inner user namespace does not grant privileges in its parent. Codex retains workspace-write and disabled tool network access. Validation remains a separate container with default seccomp, no credentials and no network.

Do not replace this profile with `seccomp=unconfined`, add `--privileged`, or disable the Codex sandbox to work around a host that cannot support the nested sandbox. Use a compatible worker host instead. Review the pinned profile when upgrading Docker or Codex.
