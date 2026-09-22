#!/usr/bin/env bash
# Verify that the published app images exist in GHCR before enabling `image:`
# in github_sync/config.yaml.
#
#   .github/scripts/check_published_images.sh            # uses config.yaml version
#   .github/scripts/check_published_images.sh 0.4.0
#
# A matching manifest means Supervisor can pull the image instead of building
# the app locally on every install/update.
set -euo pipefail

OWNER="${OWNER:-sandro-defender}"
IMAGE="${IMAGE:-github_sync}"
VERSION="${1:-$(sed -n 's/^version:[[:space:]]*"\?\([^"]*\)"\?/\1/p' github_sync/config.yaml | head -1)}"

if [[ -z "${VERSION}" ]]; then
  echo "Could not determine the app version — pass it explicitly." >&2
  exit 2
fi

token() { # repository -> bearer token (anonymous pull scope)
  curl -fsSL "https://ghcr.io/token?scope=repository:${1}:pull&service=ghcr.io" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'
}

check() { # repository tag label
  local repo="$1" tag="$2" label="$3" code
  local auth
  if ! auth="$(token "${repo}")" || [[ -z "${auth}" ]]; then
    printf '  \033[33m?\033[0m %-46s %s (registry unreachable — run this where ghcr.io is accessible)\n' "${label}" "${tag}"
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
    NEEDS_PUBLIC=1
    return 1
  fi
  printf '  \033[31m✗\033[0m %-46s %s (HTTP %s)\n' "${label}" "${tag}" "${code}"
  return 1
}

echo "Checking GHCR images for version ${VERSION}:"
status=0
NEEDS_PUBLIC=0
check "${OWNER}/${IMAGE}" "${VERSION}" "manifest ${OWNER}/${IMAGE}" || status=1
check "${OWNER}/${IMAGE}" latest "manifest ${OWNER}/${IMAGE} (latest)" || status=1
check "${OWNER}/aarch64-${IMAGE}" "${VERSION}" "arch image aarch64-${IMAGE}" || status=1
check "${OWNER}/amd64-${IMAGE}" "${VERSION}" "arch image amd64-${IMAGE}" || status=1

if [[ ${status} -eq 0 ]]; then
  cat <<EOF

All images for ${VERSION} are published. Enable the pre-built image in
github_sync/config.yaml:

    image: "ghcr.io/${OWNER}/${IMAGE}"

then commit and ship a patch release.
EOF
elif [[ ${NEEDS_PUBLIC} -eq 1 ]]; then
  cat <<EOF

The registry answered 401/403: the packages exist but are **private**, and
GitHub creates container packages as private by default. Supervisor pulls
anonymously, so installs fail with "unauthorized" until they are public.

Fix it once per package in the browser (there is no API for visibility):

  https://github.com/users/${OWNER}/packages/container/package/${IMAGE}
  https://github.com/users/${OWNER}/packages/container/package/aarch64-${IMAGE}
  https://github.com/users/${OWNER}/packages/container/package/amd64-${IMAGE}

  Each page → Package settings → Danger Zone → Change visibility → Public

Then re-run this script; it must print a green ✓ for all four lines before
github_sync/config.yaml keeps its image: field.
EOF
  exit 1
else
  cat <<EOF

Some images are missing. If the "Publish app image" workflow never ran for this
version, trigger it manually:

    gh workflow run publish.yml
    gh run list --workflow=publish.yml --limit 3

Keep github_sync/config.yaml without the image: field until every check above
passes — Supervisor would otherwise fail to install a version whose image does
not exist.
EOF
  exit 1
fi
