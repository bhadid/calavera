# wrapper-lite (WorldObservationLog/wrapper, branch "lite") built from source
# at a pinned commit, plus Calavera's supervisor.
#
# Upstream publishes no wrapper-lite releases, so this compiles it the same way
# upstream's own Dockerfile does (Android NDK r23b + CMake). The build stage
# downloads about 1 GB and takes several minutes; the runtime image is small.
#
# Builds with this directory as its only context, also straight from git:
#   docker build https://github.com/bhadid/calavera.git#<tag>:wrapper

ARG DEBIAN_VERSION=13.2

FROM debian:${DEBIAN_VERSION} AS build
ARG WRAPPER_REPO=https://github.com/WorldObservationLog/wrapper
# The pinned wrapper-lite commit. Updating it: see README, "Updating the
# pinned components" (.github/scripts/check-upstream.sh reads this line).
ARG WRAPPER_REF=386ec82e1fc9c9761aa68060a2be6f19d39106fc
# Android NDK r23b and the SHA-256 of android-ndk-r23b-linux.zip (Google
# publishes the SHA-1, f47ec4c4badd11e9f593a8450180884a927c330d, which this
# file also matches). Change both together.
ARG NDK_VERSION=23
ARG NDK_SHA256=c6e97f9c8cfe5b7be0a9e6c15af8e7a179475b7ded23e2d1c1fa0945d6fb4382
SHELL ["/bin/bash", "-c"]
WORKDIR /app
RUN apt-get update \
    && apt-get install -y build-essential cmake unzip git ca-certificates aria2 \
    && rm -rf /var/lib/apt/lists/*
RUN git init -q . \
    && git remote add origin "${WRAPPER_REPO}" \
    && git fetch -q --depth 1 origin "${WRAPPER_REF}" \
    && git checkout -q FETCH_HEAD
RUN aria2c -q -o ndk.zip "https://dl.google.com/android/repository/android-ndk-r${NDK_VERSION}b-linux.zip" \
    && echo "${NDK_SHA256}  ndk.zip" | sha256sum -c - \
    && unzip -q -d /app ndk.zip \
    && rm ndk.zip
RUN cmake -S /app -B /app/build -DCMAKE_BUILD_TYPE=Release -DBUILD_HOST_LAUNCHERS=ON \
    && cmake --build /app/build --target wrapper_lite_exe wrapper_lite_rootless_exe -j"$(nproc)" \
    && cmake --build /app/build -j"$(nproc)"

FROM debian:${DEBIAN_VERSION}-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/wrapper-lite-rootless /app/wrapper-lite-rootless
COPY --from=build /app/rootfs /app/rootfs
COPY supervisor.py /app/supervisor.py
# Runs as an unprivileged user (10001, not a user of the host). Before
# dropping root, prepare what that user must be able to write:
# - rootfs/dev/urandom: the launcher opens it read-write before bind-mounting
#   the device over it (rootfs/dev and rootfs/proc only need to exist);
# - rootfs/data and /control: the mount points of the two volumes. Docker
#   copies this ownership into a new, empty named volume, so fresh installs
#   need no further step. Volumes from Calavera 0.5.0 or older hold
#   root-owned files: see README, "Upgrading from 0.5.0 or older".
RUN chmod +x /app/wrapper-lite-rootless \
    && mkdir -p /app/rootfs/dev /app/rootfs/proc /app/rootfs/data /control \
    && touch /app/rootfs/dev/urandom \
    && chown 10001:10001 /app/rootfs/dev/urandom /control \
    && chown -R 10001:10001 /app/rootfs/data
USER 10001:10001
ENV PYTHONUNBUFFERED=1
# 12340: wrapper-lite API (used by amdl). 12341: supervisor control API.
EXPOSE 12340 12341
ENTRYPOINT ["python3", "/app/supervisor.py"]
