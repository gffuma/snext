#!/bin/bash

# Is this a workaround? I live using workarounds since '93

EX=${1:-base}

rm -rf ./examples/${EX}/node_modules/react
rm -rf ./examples/${EX}/node_modules/react-dom
ln -s ../../../node_modules/react examples/${EX}/node_modules/react
ln -s ../../../node_modules/react-dom examples/${EX}/node_modules/react-dom
cd ./examples/${EX} && yarn link pluffa && yarn link @pluffa/statik && \
rm -rf ./node_modules/.bin/pluffa && \
ln -s ../pluffa/bootstrap.cjs  ./node_modules/.bin/pluffa && \
chmod +x ./node_modules/.bin/pluffa  && cd ../../