#!/bin/bash
# This script will install towncrier and check if a newsfile exists on the current checkout.

pip3 install towncrier==19.2.0
python3 -m towncrier.check --compare-with=origin/develop
