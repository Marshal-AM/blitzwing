# blitzwing

Interactive setup wizard to contribute layers to a Blitzwing Petals mother swarm.

## Install

```bash
npm i -g blitzwing
```

## Use

```bash
blitzwing
```

The wizard talks to the **Discovery Service** (no mother URL to type), asks which model and how many layers to host, installs Petals if needed, and joins the swarm.

```bash
blitzwing status
blitzwing leave
```

Override discovery URL (dev/staging only):

```bash
export BLITZWING_DISCOVERY_URL=http://127.0.0.1:9000
blitzwing
```
