#!/bin/bash

cd backend && npm start &
xvfb-run --auto-servernum npm run ui-test:run
