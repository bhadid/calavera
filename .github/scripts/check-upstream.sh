#!/usr/bin/env bash
# Compare the upstream versions pinned in compose.yaml with what upstream has
# published, and open (or update) an issue for each component that is behind.
#
# It only reports. Updating is a manual step, because every amdl or
# wrapper-lite update needs a test download (see README, "Updating").
#
#   DRY_RUN=1 .github/scripts/check-upstream.sh     print instead of touching issues
#
# Needs curl and jq. Issue operations use the GitHub CLI (`gh`), which is
# preinstalled on GitHub's runners and reads GH_TOKEN.
set -euo pipefail

AMDL_REPO="zhaarey/apple-music-downloader"
WRAPPER_REPO="WorldObservationLog/wrapper"
WRAPPER_BRANCH="lite"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yaml}"
LABEL="upstream"
DRY_RUN="${DRY_RUN:-}"

api() {
  local auth=()
  [ -n "${GH_TOKEN:-}" ] && auth=(-H "Authorization: Bearer ${GH_TOKEN}")
  curl -fsSL --retry 3 -H "Accept: application/vnd.github+json" "${auth[@]}" "https://api.github.com/$1"
}

pin() {
  # The value of "<KEY>: value" in compose.yaml, without quotes.
  local value
  value="$(sed -n "s/^[[:space:]]*$1:[[:space:]]*//p" "$COMPOSE_FILE" | head -n1 | tr -d "\"'")"
  [ -n "$value" ] || { echo "error: $1 not found in $COMPOSE_FILE" >&2; exit 1; }
  printf '%s' "$value"
}

# report <component> <version it is now at> <issue body>
# One open issue per component. If one is already open, a comment is added
# only when upstream has moved again since it was written.
report() {
  local component="$1" latest="$2" body="$3"
  local title="Upstream update available: ${component}"
  if [ -n "$DRY_RUN" ]; then
    printf '\n--- would open or update issue: %s ---\n%s\n' "$title" "$body"
    return
  fi
  gh label create "$LABEL" --color FF4FA0 --description "A pinned upstream component has a newer version" --force >/dev/null
  local number
  number="$(gh issue list --state open --label "$LABEL" --search "in:title \"${title}\"" --json number,title \
    --jq "map(select(.title == \"${title}\")) | .[0].number // empty")"
  if [ -z "$number" ]; then
    gh issue create --title "$title" --label "$LABEL" --body "$body"
  elif gh issue view "$number" --json body,comments --jq '.body, .comments[].body' | grep -qF "$latest"; then
    echo "${component}: issue #${number} already mentions ${latest}"
  else
    gh issue comment "$number" --body "$body"
  fi
}

status=0

# --- amdl: latest published release -------------------------------------------
pinned_amdl="$(pin AMDL_VERSION)"
latest_amdl="$(api "repos/${AMDL_REPO}/releases/latest" | jq -r .tag_name)"
echo "amdl:         pinned ${pinned_amdl}, latest release ${latest_amdl}"
if [ "$latest_amdl" != "$pinned_amdl" ] && [ "$latest_amdl" != "null" ]; then
  sha256="$(curl -fsSL --retry 3 "https://github.com/${AMDL_REPO}/releases/download/${latest_amdl}/checksums.txt" \
    | awk '$2 == "amdl_linux_amd64" {print $1}' || true)"
  [ -n "$sha256" ] || sha256="<SHA-256 of amdl_linux_amd64, from checksums.txt in the release>"
  report "amdl" "$latest_amdl" "$(cat <<BODY
amdl has a newer release: **${latest_amdl}** (Calavera pins \`${pinned_amdl}\`).

- Release notes: https://github.com/${AMDL_REPO}/releases/tag/${latest_amdl}
- Changes: https://github.com/${AMDL_REPO}/compare/${pinned_amdl}...${latest_amdl}

To update, set in \`compose.yaml\` under \`app.build.args\`:

\`\`\`yaml
AMDL_VERSION: ${latest_amdl}
AMDL_SHA256: ${sha256}
\`\`\`

then \`docker compose build app && docker compose up -d\`.

**Test before relying on it.** Calavera reads amdl's terminal output and writes its config file. Download one album and check that progress, the result and the imported files are right. If the config format changed, \`app/backend/calavera/amdl.py\` needs the same change.

There is no need to update while downloads work; close this issue to skip the release.
BODY
)"
  status=10
fi

# --- wrapper-lite: newest commit on its branch (it publishes no releases) ------
pinned_wrapper="$(pin WRAPPER_REF)"
latest_wrapper="$(api "repos/${WRAPPER_REPO}/commits/${WRAPPER_BRANCH}" | jq -r .sha)"
echo "wrapper-lite: pinned ${pinned_wrapper:0:12}, newest commit ${latest_wrapper:0:12}"
if [ "$latest_wrapper" != "$pinned_wrapper" ] && [ "$latest_wrapper" != "null" ]; then
  commits="$(api "repos/${WRAPPER_REPO}/compare/${pinned_wrapper}...${latest_wrapper}" \
    | jq -r '"\(.ahead_by) new commit(s):\n" + ([.commits[-15:][] | "- `\(.sha[0:7])` \(.commit.message | split("\n")[0])"] | join("\n"))' || true)"
  report "wrapper-lite" "$latest_wrapper" "$(cat <<BODY
wrapper-lite has new commits on \`${WRAPPER_BRANCH}\`: now at \`${latest_wrapper}\` (Calavera pins \`${pinned_wrapper:0:12}\`).

${commits}

Full diff: https://github.com/${WRAPPER_REPO}/compare/${pinned_wrapper}...${latest_wrapper}

To update, set in \`compose.yaml\` under \`wrapper.build.args\`:

\`\`\`yaml
WRAPPER_REF: ${latest_wrapper}
\`\`\`

then \`docker compose build wrapper && docker compose up -d\` (the build takes several minutes). The Apple session is kept.

**Test before relying on it:** check that the Account page shows "signed in" and download one album.

There is no need to update while sign-in and downloads work; close this issue to skip these commits. It is reopened as a new issue only when upstream moves again.
BODY
)"
  status=10
fi

[ "$status" -eq 0 ] && echo "Everything pinned is current."
exit 0
