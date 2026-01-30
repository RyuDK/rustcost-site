# Metrics

This document explains the current metrics subsystem.  
The goal is **low cognitive overhead**: you can trace the flow from **collection → ingest → rollup → storage → retention**.

---

## Goals

- **Append-only** storage for fast writes and predictable IO.
- **Deterministic rollups**: Minute → Hour → Day.
- **Clear field semantics** (counter vs gauge) to avoid aggregation bugs.
- **Contributor-friendly**: minimal modules, stable naming, and single-responsibility files.

Non-goals (for now):
- Pluggable backends (Postgres/S3).
- TSDB is the single backend currently.

---

## Directory Layout

- `metrics/model/`
    - Metric primitives.
- `metrics/policy/`
    - Aggregation semantics and rollup windows.
- `metrics/storage/tsdb/`
    - `.rcd` path policy, encoder/decoder, append-only store.
- `metrics/pipeline/ingest/`
    - Mappers that transform Kubelet DTOs into `PlatformMetric` and append to TSDB.
- `metrics/pipeline/rollup/`
    - Jobs that read a range and write rollups (Minute→Hour, Hour→Day).
- `metrics/pipeline/retention/`
    - Jobs that delete old `.rcd` partitions (policy is supplied by caller).

---

## Storage Model (.rcd TSDB)

### Root and file layout

Partitioning by resolution:

- Minute data: one file per **day** (`YYYY-MM-DD.rcd`)
- Hour data: one file per **month** (`YYYY-MM.rcd`)
- Day data: one file per **year** (`YYYY.rcd`)

Directory structure:

- `{root}/{kind}/{resource_key}/{shard}/{partition}.rcd`
    - `kind`: `node | pod | container`
    - `shard`: `m | h | d` (minute/hour/day)

Example (container minute):

- `.../container/<podUID-containerName>/m/2026-01-30.rcd`

### Append-only writes

`RcdTsdbStore::append(...)` always:
1. Computes file path using `RcdPathPolicy`.
2. Ensures parent directories exist.
3. Appends one line (encoded metric) to the file.

This keeps write performance predictable and avoids in-place updates.

---

## Field Semantics and Rollup Rules

Rollup correctness depends on field semantics:

- **Counter**: monotonic totals (CPU ns, network bytes). Aggregation uses **delta** with reset handling.
- **Gauge**: point-in-time values (memory bytes, fs used). Aggregation uses **avg/last** depending on stability.

### Core field policy (`AggregationPolicy::CORE_SPECS`)

- CPU:
    - `cpu_usage_core_nano_seconds`: Counter → Delta (ClampToZero)
    - `cpu_usage_nano_cores`: Gauge → Avg
- Memory:
    - `memory_*_bytes`: Gauge → Avg
    - `memory_page_faults`: Counter → Delta (ClampToZero)
- Network:
    - `network_*_bytes_total`: Counter → Delta (ClampToZero)
- Filesystem:
    - `fs_used_bytes`, `fs_available_bytes`: Gauge → Avg
    - `fs_capacity_bytes`: Gauge → Last
    - `fs_inodes_used`: Gauge → Avg
    - `fs_inodes`: Gauge → Last
- Persistent Volume:
    - `pv_used_bytes`: Gauge → Avg
    - `pv_capacity_bytes`: Gauge → Last
    - `pv_inodes_used`: Gauge → Avg
    - `pv_inodes`: Gauge → Last
- Requests/Limits:
    - treated as step functions → Gauge → Last

---

## Ingest

Entry points (per resource type):

- `metrics/pipeline/ingest/k8s/minute.rs`
    - `ingest_container_minute(container_key, dto, now)`
    - `ingest_pod_minute(pod_key, dto, now)`
    - `ingest_node_minute(node_key, dto, now)`

Each function:
1. Builds `ResourceId` (platform + kind + key).
2. Maps DTO fields into `PlatformMetric.metrics`.
3. Appends to `Resolution::Minute` in TSDB.

---

## Rollup Jobs (Minute → Hour → Day)

Entry points:

- `metrics/pipeline/rollup/k8s.rs`
    - `rollup_container_minute_hour_day(key, start, end)`
    - `rollup_pod_minute_hour_day(key, start, end)`
    - `rollup_node_minute_hour_day(key, start, end)`

Behavior:
- Reads source samples in `[start, end)`.
- Produces one output per target bucket (hour/day).
- Appends rolled-up metrics to TSDB.

Caller owns scheduling (e.g., run hourly/daily with appropriate `start/end`).

---

## Retention Cleanup (Delete old partitions)

Entry points:

- `metrics/pipeline/retention/k8s.rs`
    - `cleanup_container(key, before_minute, before_hour, before_day)`
    - `cleanup_pod(key, before_minute, before_hour, before_day)`
    - `cleanup_node(key, before_minute, before_hour, before_day)`

Important design choice:
- TSDB does **not** decide retention periods.
- The caller supplies `before_*` cutoffs, matching legacy ownership of retention policy.

Deletion rules match legacy:
- Minute partitions compare by `YYYY-MM-DD`
- Hour partitions compare by `YYYY-MM`
- Day partitions compare by `YYYY`

---

## Contribution Tips

- Start with **one resource kind** (container) and validate:
    - minute ingest output
    - hour rollup output for a known window
    - retention deletion for a cutoff
- Add fields by updating:
    1) DTO struct
    2) `AggregationPolicy::CORE_SPECS`
    3) DTO → `PlatformMetric` mapper