#!/usr/bin/env bash
# Verify that the published app images exist in GHCR.
#
#   .github/scripts/check_published_images.sh            # uses config.yaml version
#   .github/scripts/check_published_images.sh 0.4.0
#
# A matching manifest means Supervisor can pull the image instead of building
# the app locally. `github_sync/config.yaml` pins `image:`, so a version whose
# manifest is missing makes every install and update fail with
# "[404] manifest unknown" — there is no local-build fallback.
#
# Exit codes: 0 all four references are live, 1 something is missing or private,
# 2 the registry could not be reached at all (nothing was proven either way).
#
# Environment: OWNER, IMAGE override the package namespace. In GitHub Actions the
# script also emits `::error::`/`::warning::` annotations with the remediation,
# so a failed publish run explains itself in the run summary.
set -euo pipefail

OWNER="${OWNER:-sandro-defender}"
IMAGE="${IMAGE:-github_sync}"
REPO_SLUG="${REPO_SLUG:-sandro-defender/Github-Sync}"
VERSION="${1:-$(sed -n 's/^version:[[:space:]]*"\?\([^"]*\)"\?/\1/p' github_sync/config.yaml | head -1)}"

if [[ -z "${VERSION}" ]]; then
  echo "Could not determine the app version — pass it explicitly." >&2
  exit 2
fi

IN_ACTIONS="${GITHUB_ACTIONS:-false}"
PACKAGE_SETTINGS="https://github.com/users/${OWNER}/packages/container"

status=0
unreachable=0
missing=0
private=0

annotate() { # level message
  [[ "${IN_ACTIONS}" == "true" ]] && printf '::%s::%s\n' "$1" "$2"
  return 0
}

token() { # repository -> bearer token (anonymous pull scope)
  curl -fsSL "https://ghcr.io/token?scope=repository:${1}:pull&service=ghcr.io" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

check() { # repository tag label
  local repo="$1" tag="$2" label="$3" code
  local auth
  if ! auth="$(token "${repo}")" || [[ -z "${auth}" ]]; then
    printf '  \033[33m?\033[0m %-46s %s (registry unreachable — run this where ghcr.io is accessible)\n' "${label}" "${tag}"
    unreachable=1
    return 1
  fi
  code="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${auth}" \
    -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json" \
    "https://ghcr.io/v2/${repo}/manifests/${tag}")"
  if [[ "${code}" == "200" ]]; then
    printf '  \033[32m✓\033[0m %-46s %s\n' "${label}" "${tag}"
    return 0
  fi
  if [[ "${code}" == "401" || "${code}" == "403" ]]; then
    printf '  \033[33m!\033[0m %-46s %s (HTTP %s — package is private)\n' "${label}" "${tag}" "${code}"
    private=1
    return 1
  fi
  printf '  \033[31m✗\033[0m %-46s %s (HTTP %s — not published)\n' "${label}" "${tag}" "${code}"
  missing=1
  annotate error "ghcr.io/${repo}:${tag} is not published (HTTP ${code}). Installs and updates of ${IMAGE} ${VERSION} fail with '[404] manifest unknown' until it exists. Re-run the 'Publish app image' workflow; if its build step reports 'denied: permission_denied: write_package', grant ${REPO_SLUG} Write access under Package settings → Manage Actions access."
  return 1
}

echo "Checking GHCR images for version ${VERSION}:"
check "${OWNER}/${IMAGE}" "${VERSION}" "manifest ${OWNER}/${IMAGE}" || status=1
check "${OWNER}/${IMAGE}" latest "manifest ${OWNER}/${IMAGE} (latest)" || status=1
for arch in aarch64 amd64; do
  check "${OWNER}/${arch}-${IMAGE}" "${VERSION}" "arch image ${arch}-${IMAGE}" || status=1
done

if [[ ${status} -eq 0 ]]; then
  cat <<EOF

All images for ${VERSION} are published and pullable anonymously, so
github_sync/config.yaml can keep:

    image: "ghcr.io/${OWNER}/${IMAGE}"

EOF
  exit 0
fi

if [[ ${unreachable} -eq 1 ]]; then
  cat <<EOF

ghcr.io could not be reached from here, so nothing was proven either way.
Re-run on a machine (or GitHub Actions runner) with registry access.
EOF
  annotate warning "Could not reach ghcr.io to verify the images for ${VERSION}; re-run where the registry is accessible."
  exit 2
fi

if [[ ${private} -eq 1 ]]; then
  annotate error "The GHCR packages for ${IMAGE} are private: Supervisor pulls anonymously, so installs fail with 'unauthorized'. Change each package to Public under Package settings → Danger Zone → Change visibility, then re-grant Actions access (see below)."
  cat <<EOF

The registry answered 401/403: the packages exist but are **private**, and
GitHub creates container packages as private by default. Supervisor pulls
anonymously, so installs fail with "unauthorized" until they are public.

Fix it once per package in the browser (there is no API for visibility):

  ${PACKAGE_SETTINGS}/${IMAGE}
  ${PACKAGE_SETTINGS}/aarch64-${IMAGE}
  ${PACKAGE_SETTINGS}/amd64-${IMAGE}

  Each page → Package settings → Danger Zone → Change visibility → Public

WARNING — making a package public switches it from "inherit access from the
linked repository" to granular permissions, and GitHub overwrites the existing
permissions when you do. That silently revokes the write access GITHUB_TOKEN
used to publish with, so the *next* build fails with
"denied: permission_denied: write_package". Re-grant it in the same sitting:

  Each page → Package settings → Manage Actions access → Add repository
  → ${REPO_SLUG} → Role: Write (or Admin)

Then re-run this script; it must print a green ✓ for all four lines.
EOF
  exit 1
fi

annotate error "The GHCR images for ${IMAGE} ${VERSION} are missing. Publish them with: gh workflow run publish.yml --ref main -f version=${VERSION}"
cat <<EOF

Some images are missing. Supervisor will fail every install/update of
${IMAGE} ${VERSION} with "[404] manifest unknown" because config.yaml pins
\`image:\` and there is no local-build fallback.

Publish them (the workflow reads the version from config.yaml unless you pass
one explicitly):

    gh workflow run publish.yml --ref main
    gh run list --workflow=publish.yml --limit 3
    gh run rerun <failed-run-id>          # after fixing a permission problem

If a build job failed with "denied: permission_denied: write_package", the
packages no longer let this repository's GITHUB_TOKEN push — usually because
their visibility was changed to Public, which drops the inherited repository
permissions. For each of the three packages:

    ${PACKAGE_SETTINGS}/<package> → Package settings
      → Manage Actions access → Add repository
      → ${REPO_SLUG} → Role: Write

Alternatively store a classic PAT with \`write:packages\` as the repository
secret GHCR_TOKEN (optionally with the GHCR_USERNAME variable); publish.yml
prefers it over GITHUB_TOKEN.

Re-run this script afterwards — all four lines must be green before a version
is advertised in github_sync/config.yaml.
EOF
exit 1
