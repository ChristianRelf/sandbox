# syntax=docker/dockerfile:1.7

FROM rust:1.88-bookworm AS build
ARG TARGETARCH
ENV CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/cargo-target
WORKDIR /source
COPY src-tauri/engine src-tauri/engine
COPY agents/server agents/server
RUN --mount=type=cache,id=sandbox-server-cargo-registry-${TARGETARCH},target=/usr/local/cargo/registry \
    --mount=type=cache,id=sandbox-server-cargo-git-${TARGETARCH},target=/usr/local/cargo/git \
    --mount=type=cache,id=sandbox-server-cargo-target-${TARGETARCH},target=/cargo-target \
    cargo build --locked --release --manifest-path agents/server/Cargo.toml && \
    install -Dm755 /cargo-target/release/sandbox-server-runner /out/sandbox-runner

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /out/sandbox-runner /usr/local/bin/sandbox-runner
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/sandbox-runner"]
