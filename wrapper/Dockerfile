# wrapper-lite (WorldObservationLog/wrapper, branch "lite") built from source
# at a pinned commit, plus Calavera's supervisor.
#
# Upstream publishes no wrapper-lite releases, so this compiles it the same way
# upstream's own Dockerfile does (Android NDK r23b + CMake). The build stage
# downloads about 1 GB and takes several minutes; the runtime image is small.

ARG DEBIAN_VERSION=13.2

FROM debian:${DEBIAN_VERSION} AS build
ARG WRAPPER_REPO=https://github.com/WorldObservationLog/wrapper
ARG WRAPPER_REF
ARG NDK_VERSION=23
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
RUN chmod +x /app/wrapper-lite-rootless
ENV PYTHONUNBUFFERED=1
# 12340: wrapper-lite API (used by amdl). 12341: supervisor control API.
EXPOSE 12340 12341
ENTRYPOINT ["python3", "/app/supervisor.py"]
