# @blitzwing/ens-service

Sepolia ENSv2 sidecar for Blitzwing host identity. The orchestrator calls this over HTTP; contributors never touch Sepolia.

```bash
npm install
npm start          # :8792
npm test           # unit tests
npm run bootstrap  # register parent .eth (operator wallet)
```

See [docs/ens-setup.md](../../docs/ens-setup.md).
