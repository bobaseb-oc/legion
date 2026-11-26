#!/bin/sh
# Served at /install.sh. This build installs nothing from the network
# (upstream's piped the hosted installer to sh): run it from its source,
# with local/legion (the `legion` alias).
echo "install.sh: not available in this build; run local/legion from its source" >&2
exit 1
