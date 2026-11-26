#!/usr/bin/env bash
# Vercel ignoreCommand: exit 0 skips the deployment, exit 1 builds it.
# Skips only when every path changed since the branch's last successful
# deployment stays out of the build: docs, tests, CI and agent config.
# Every other path builds, so migrations (drizzle/) and scripts always deploy.
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
# A branch's first deployment, CLI deploys and redeploys have no baseline.
[ -n "$prev" ] || exit 1
# Vercel clones shallowly. Fetch the baseline, or build when it is unreachable.
git cat-file -e "${prev}^{commit}" 2>/dev/null ||
  git fetch --quiet --depth=1 origin "$prev" 2>/dev/null ||
  exit 1
# An empty diff is an intentional redeploy, such as an empty commit.
git diff --quiet "$prev" HEAD && exit 1
git diff --quiet "$prev" HEAD -- . \
  ':(exclude,glob)docs/**' \
  ':(exclude,glob)media/**' \
  ':(exclude,glob)tests/**' \
  ':(exclude,glob).github/**' \
  ':(exclude,glob).agents/**' \
  ':(exclude,glob).codex/**' \
  ':(exclude,glob).cursor/**' \
  ':(exclude,glob)**/*.md' \
  ':(exclude,glob)**/*.test.ts' \
  ':(exclude,glob)**/*.test.tsx'
# 0 means nothing outside the list changed; 1 (changes) or an error builds.
[ $? -eq 0 ] && exit 0
exit 1
