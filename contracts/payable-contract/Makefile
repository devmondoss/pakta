default: build

all: test

test: build
	cd .. && cargo test --workspace

build:
	cd .. && cargo build --target wasm32v1-none --release

fmt:
	cd .. && cargo fmt --all

clean:
	cd .. && cargo clean
