# Praksis Web

A browser client for the [Praksis](https://github.com/tuhde/Praksis) daemon. Like
[Praksis-Desktop](https://github.com/tuhde/Praksis-Desktop) it is a generic renderer: the daemon
describes the screens and views, and this page shows them. It holds no logic of its own.

**Status:** skeleton. It logs in with a token and shows the status and the list of views of the
daemon.

## Try it

1. In the `praksis.toml` of the daemon:

       [web]
       listen  = "127.0.0.1:8484"
       origins = ["http://localhost:8080"]

   and restart the daemon. The listener is off without this section and accepts loopback addresses
   only.
2. `praksis web token create laptop` (add `--read-only` for a token that may only look). The token
   is shown once.
3. `npm install && npm run serve`, open <http://localhost:8080> and enter the address and the token.

## Security

- The token is kept in memory only (the address is remembered for the session, never the token),
  and there are no cookies.
- Data from the daemon is only ever put into the page as text (`textContent`); a test fails if the
  sources use `innerHTML` or the like. No script from a module, a ruleset or a view runs here.
- The page has a strict content security policy: scripts and styles from itself only, connections
  to loopback addresses only.
- What a token may do is decided by the daemon. A web token cannot answer approvals, change grants
  or the ruleset; those stay at the daemon (the command line or the desktop program).

## Build and test

    npm run build   # tsc into dist/
    npm test        # builds, then runs the tests with node --test

Plain TypeScript, no framework; the only dependencies are the compiler and the Node types.

## License

Apache License 2.0, see [LICENSE](LICENSE).
