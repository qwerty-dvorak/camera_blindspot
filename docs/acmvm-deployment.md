# acmvm Deployment

This project is normally run on the `acmvm` host from the `camera_blindspot` checkout, then viewed from a local browser through an SSH port forward.

## Deploy Latest Commit

From your local checkout:

```bash
git status
git add <files>
git commit -m "<message>"
git push
```

On the VM:

```bash
ssh acmvm
cd camera_blindspot
git pull
docker compose up --build -d
docker compose ps
```

If port `3000` is already in use on the VM, choose another host port:

```bash
APP_PORT=3001 docker compose up --build -d
```

## View From Localhost

Keep this SSH session open from your local machine:

```bash
ssh -L 3002:localhost:3000 acmvm
```

Then open http://localhost:3002.

If the VM app is running with `APP_PORT=3001`, forward that remote port instead:

```bash
ssh -L 3002:localhost:3001 acmvm
```

Then open http://localhost:3002.

## Useful Operations

Check logs:

```bash
ssh acmvm
cd camera_blindspot
docker compose logs -f app
```

Restart without rebuilding:

```bash
ssh acmvm
cd camera_blindspot
docker compose up -d
```

Stop the stack:

```bash
ssh acmvm
cd camera_blindspot
docker compose down
```
