# syntax=docker/dockerfile:1.7
FROM rust:1.89-bookworm AS build
ARG TARGETARCH
ENV CARGO_INCREMENTAL=0 CARGO_TARGET_DIR=/cargo-target
WORKDIR /source
COPY src-tauri/engine /source/src-tauri/engine
COPY services/hosted-runner /source/services/hosted-runner
RUN --mount=type=cache,id=sandbox-hosted-cargo-registry-${TARGETARCH},target=/usr/local/cargo/registry \
    --mount=type=cache,id=sandbox-hosted-cargo-git-${TARGETARCH},target=/usr/local/cargo/git \
    --mount=type=cache,id=sandbox-hosted-cargo-target-${TARGETARCH},target=/cargo-target \
    cargo build --locked --release --manifest-path /source/services/hosted-runner/Cargo.toml && \
    install -Dm755 /cargo-target/release/sandbox-hosted-runner /out/sandbox-hosted-runner

FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /out/sandbox-hosted-runner /usr/local/bin/sandbox-hosted-runner
USER nonroot:nonroot
ENTRYPOINT ["/usr/local/bin/sandbox-hosted-runner"]
