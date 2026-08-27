FROM rust:1.88-bookworm AS build
WORKDIR /source
COPY agents/server agents/server
RUN cargo build --locked --release --manifest-path agents/server/Cargo.toml
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /source/agents/server/target/release/sandbox-server-runner /usr/local/bin/sandbox-runner
ENTRYPOINT ["/usr/local/bin/sandbox-runner"]
