#!/usr/bin/env bash
# Default personal-task demo. Fictional data only. Run against a fresh instance:
# SWARM_URL=... SWARM_SECRET=... demo/seed.sh --seed-only
# Prior named scenarios are opt-in: seed-community.sh and seed-fund.sh.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
c="$here/../clients/swarm.sh"
if [[ " ${*:-} " == *" --steps-only "* ]]; then
  "$c" recall juno "What did I agree to in that private conversation?"
  exit 0
fi
"$c" org-create juno demo-workspace "Shared project" sealed >/dev/null
"$c" org-add juno demo-workspace demo-peer >/dev/null
"$c" remember juno "In that private conversation I agreed to deliver a first project outline by Friday, cap the pilot budget at \$2,400, and ask for written approval before any public announcement. Internal agreement marker AGREEMENT-CANARY-9274. This is private, not material for the proposal." >/dev/null
"$c" remember juno "Project proposal: define the problem, run a small pilot, and evaluate results with the people who will use it. Private budget \$2,400; contact juno@demo.example. PROJECT-CANARY-6602." demo-workspace >/dev/null
"$c" remember demo-peer "Our shared project needs research, a pilot, and a clear evaluation before launch. Project work should start small and record useful evidence." demo-workspace >/dev/null
"$c" remember demo-peer "Private peer conversation: never share this personal note with other members. PEER-CANARY-8819." >/dev/null
printf 'Seeded personal agreement, shared project, and isolated peer memory. All fictional.\n'
