# Contributing to The Chronicle

Thanks for your interest in improving The Chronicle! Contributions are welcome.

Please open an issue first to discuss what you'd like to change, so we can avoid
duplicated or conflicting work.

## Development setup

```bash
npm install
npm run server        # browser/dev mode → http://localhost:3737
npm start             # launch the Electron desktop window
```

See the [README](README.md#run-it-browser--dev--no-display-needed) for more on the
architecture and how a settings save round-trips through the supervisor.

## Pull request workflow

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'feat: describe change'`)
4. Push and open a pull request

## Before submitting

- Make sure the app still builds: `npm run dist` (produces `dist/The Chronicle-<version>-arm64.dmg`).
- Keep changes focused — one logical change per PR.
- Match the existing code style of the files you touch.

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
