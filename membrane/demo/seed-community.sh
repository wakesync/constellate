#!/usr/bin/env bash
# membrane demo: the community scenario. An artist residency and a solar co-op
# down the street share one membrane. All names, numbers and codes are made up.
#
#   Lantern House       (artist residency)  wall: sealed  members: odessa (admin), pim, juno
#   Sunrise Solar Co-op (energy co-op)      wall: sealed  members: wren (admin), tal, juno
#
#   juno sits in both (the bridge). tal (co-op only) asking about rooftops gets
#   "a group in your network knows", never who or what.
#
#   SWARM_URL=http://127.0.0.1:18090 SWARM_SECRET=... demo/seed.sh [--slow] [--seed-only|--steps-only]
#   The old fund / startup scenario lives in demo/seed-fund.sh.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
c="$here/../clients/swarm.sh"
slow=""; only=""
for a in "$@"; do case "$a" in --slow) slow=1 ;; --seed-only|--steps-only) only=$a ;; esac; done
pause() { [ -n "$slow" ] && sleep "${1:-1.2}" || true; }
q() { "$@" >/dev/null; }

A=$'\033[38;5;214m'; C=$'\033[38;5;45m'; D=$'\033[2m'; X=$'\033[0m'
hdr() { printf '\n%s== %s %s\n' "$A" "$*" "$X"; }
who() { printf '%s%s%s %s\n' "$C" "$1" "$X" "$2"; }
show() { python3 "$here/show.py"; }

if [ "$only" != "--steps-only" ]; then
hdr "setup: 2 groups, 5 people, juno in both"
q "$c" org-create odessa lantern-house "Lantern House" sealed
q "$c" org-add odessa lantern-house pim
q "$c" org-add odessa lantern-house juno
q "$c" org-create wren sunrise-coop "Sunrise Solar Co-op" sealed
q "$c" org-add wren sunrise-coop tal
q "$c" org-add wren sunrise-coop juno
who "Lantern House      " "[sealed]  odessa(admin), pim, juno"
who "Sunrise Solar Co-op" "[sealed]  wren(admin), tal, juno"
pause

hdr "agents write memory into their groups (plaintext only ever exists inside the enclave)"
q "$c" remember odessa "Lantern House house meeting decided the rooftop question: residents voted 7 to 2 to lease the east rooftop to Sunrise Solar Co-op for a 14 kW solar pilot at \$1,850 a month starting January. Odessa Vane signs the lease for the house. Internal code LH-CANARY-5521." lantern-house; who odessa "-> Lantern House"; pause .6
q "$c" remember pim "Lantern House rooftop: the house also decided the north half of the roof stays a studio garden for weekend sculpture classes, and the solar panels must leave a walkway." lantern-house; who pim "-> Lantern House"; pause .6
q "$c" remember juno "Lantern House stipends: each resident artist gets \$1,200 a month, paid from studio rent plus the rooftop lease income." lantern-house; who juno "-> Lantern House"; pause .6
q "$c" remember wren "Sunrise Solar Co-op has 212 member households in Greenpoint and needs a rooftop for a 14 kW community solar pilot. Treasurer Wren Halloway, wren@sunrise-coop.example, account ending 4471. Internal code SC-CANARY-8830." sunrise-coop; who wren "-> Sunrise Solar Co-op"; pause .6
q "$c" remember tal "Sunrise Solar Co-op grant goal: \$90,000 from a state community solar fund to cover panels and a paid electrician apprenticeship for two members, Tal Brenner leads the application." sunrise-coop; who tal "-> Sunrise Solar Co-op"; pause .6
q "$c" remember juno "Sunrise Solar Co-op mission: cheaper, cleaner power owned by the households that use it. Surplus from the pilot funds artist stipends at Lantern House." sunrise-coop; who juno "-> Sunrise Solar Co-op"; pause .6
q "$c" remember juno "Personal: I am nervous the lease vote splits the house, keep this to myself. JUNO-CANARY-3307." ; who juno "-> personal (author-only)"
fi

[ "$only" = "--seed-only" ] && exit 0

Q="Who has a rooftop we could use for our solar pilot, and on what terms?"
"$c" wall odessa lantern-house signal >/dev/null
hdr "(a) tal @ Sunrise Solar Co-op asks. The answer lives in Lantern House (wall: signal)"
printf '%s"%s"%s\n' "$D" "$Q" "$X"
"$c" recall tal "$Q" | show
pause 2
hdr "(b) juno, in both groups, asks the same thing"
"$c" recall juno "$Q" | show
pause 2
hdr "(c) odessa flips Lantern House: signal -> open-derived"
"$c" wall odessa lantern-house open-derived >/dev/null
"$c" recall tal "$Q" | show
printf '  %s(derived answer only: no raw notes, no author, no canary.)%s\n' "$D" "$X"
"$c" wall odessa lantern-house sealed >/dev/null
