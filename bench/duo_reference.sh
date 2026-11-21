#!/bin/sh
# The reference for forgetting: Duolingo's own code for half-life regression and the other
# methods in Settles & Meeder (2016), run on the first 3,000,000 reviews of their public data
# (the first 90% to learn from, the last 10% to test on, as their script does).
# Their script is Python 2; the four sed lines are the whole change needed for Python 3.
#   sh bench/duo_reference.sh
set -e
cd "$(dirname "$0")/data/duo"
[ -f traces.csv.gz ] || curl -sL -o traces.csv.gz "https://dataverse.harvard.edu/api/access/datafile/3091087"
[ -d hlr ] || git clone -q --depth 1 https://github.com/duolingo/halflife-regression hlr
sed -e 's/intern(/sys.intern(/g' -e 's/\.iteritems()/.items()/g' -e "s/open(fname, 'wb')/open(fname, 'w')/g" \
    -e "s/gzip.open(input_file, 'rb')/gzip.open(input_file, 'rt')/" hlr/experiment.py > experiment3.py
for method in hlr lr leitner pimsleur; do
  python3 experiment3.py -m $method -x 3000000 traces.csv.gz
done
ls results
