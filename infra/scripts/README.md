# Deployment scripts

The supported update path is `.github/workflows/deploy.yml`: a push to main runs CI and E2E, builds images on GitHub, then invokes `deploy-release.sh` over SSH using the tested commit. Both collaborators can trigger it by pushing main.

See [the complete VPS setup guide](../../DEPLOYMENT.md) for Docker, the deployment account, the two SSH key pairs, Actions secrets, HTTPS, first seed, and health checks.

`deploy-release.sh` pulls the commit-tagged images, starts infrastructure, waits for healthy API/web/Nginx, and records `.release.env` and `.deployed-sha`. API migrations run in the API entrypoint. It does not seed automatically or build on the VPS. Do not invoke it with an arbitrary untested commit to bypass the workflow.

`auto-deploy.sh` and `auto-deploy.service` are legacy artifacts. Do not install or enable that service on the fresh host: it can deploy mutable latest images independently of CI. Docker restart policies handle ordinary reboots.
