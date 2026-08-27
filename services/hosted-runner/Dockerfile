# syntax=docker/dockerfile:1.7
FROM rust:1.89-bookworm AS build
WORKDIR /source
COPY src-tauri/engine /source/src-tauri/engine
COPY services/hosted-runner /source/services/hosted-runner
RUN cargo build --locked --release --manifest-path /source/services/hosted-runner/Cargo.toml

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /source/services/hosted-runner/target/release/sandbox-hosted-runner /usr/local/bin/sandbox-hosted-runner
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/sandbox-hosted-runner"]

