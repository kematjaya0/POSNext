<template>
	<Dialog v-model="show" :options="{ title: __('Scan QR Pesanan SPG'), size: 'md' }">
		<template #body-content>
			<div class="flex flex-col gap-3">
				<div class="relative w-full overflow-hidden rounded-lg bg-black aspect-square">
					<video
						ref="videoRef"
						class="w-full h-full object-cover"
						muted
						playsinline
					></video>
					<div
						v-if="starting && !errorText"
						class="absolute inset-0 flex items-center justify-center text-sm text-white"
					>
						{{ __("Membuka kamera...") }}
					</div>
					<div
						v-if="errorText"
						class="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white"
					>
						{{ errorText }}
					</div>
				</div>
				<p class="text-xs text-gray-500 text-center">
					{{ hintText || __("Arahkan kamera ke QR di struk pesanan SPG.") }}
				</p>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { parsePosOrderCode } from "@/utils/posOrderCode";
import { Dialog } from "frappe-ui";
import QrScanner from "qr-scanner";
import { computed, nextTick, onUnmounted, ref, watch } from "vue";

/**
 * Cashier: read an SPG order slip QR with the device camera instead of a
 * handheld scanner. Emits the parsed order code (same shape as a scanned
 * slip, see parsePosOrderCode) and closes; other QR codes are ignored.
 */
const props = defineProps({
	modelValue: Boolean,
});

const emit = defineEmits(["update:modelValue", "scanned"]);

const show = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

const videoRef = ref(null);
const starting = ref(false);
const errorText = ref("");
const hintText = ref("");
let scanner = null;

// The order QR is dense (a whole order as JSON): scan the largest centred
// square at up to 800px instead of the library's default 400px.
function scanRegion(video) {
	const size = Math.min(video.videoWidth, video.videoHeight);
	const scaled = Math.min(size, 800);
	return {
		x: Math.round((video.videoWidth - size) / 2),
		y: Math.round((video.videoHeight - size) / 2),
		width: size,
		height: size,
		downScaledWidth: scaled,
		downScaledHeight: scaled,
	};
}

function onDecode(result) {
	const code = parsePosOrderCode(result.data);
	if (!code) {
		hintText.value = __("Bukan QR pesanan SPG.");
		return;
	}
	stopCamera();
	show.value = false;
	emit("scanned", code);
}

function cameraError(error) {
	const name = error?.name || "";
	if (!window.isSecureContext) {
		return __("Kamera hanya bisa dipakai lewat HTTPS.");
	}
	if (name === "NotAllowedError") {
		return __("Izin kamera ditolak. Izinkan akses kamera di pengaturan browser.");
	}
	if (name === "NotReadableError") {
		return __("Kamera sedang dipakai aplikasi lain.");
	}
	if (String(error).includes("Camera not found")) {
		return __("Kamera tidak ditemukan di perangkat ini.");
	}
	return __("Gagal membuka kamera: {0}", [error?.message || String(error)]);
}

async function startCamera() {
	errorText.value = "";
	hintText.value = "";
	starting.value = true;
	await nextTick();
	if (!videoRef.value || !show.value) return;
	try {
		scanner = new QrScanner(videoRef.value, onDecode, {
			preferredCamera: "environment",
			returnDetailedScanResult: true,
			calculateScanRegion: scanRegion,
			maxScansPerSecond: 10,
		});
		await scanner.start();
		// Closed while the camera was still opening
		if (!show.value) stopCamera();
	} catch (error) {
		stopCamera();
		errorText.value = cameraError(error);
	} finally {
		starting.value = false;
	}
}

function stopCamera() {
	scanner?.destroy();
	scanner = null;
}

watch(show, (value) => {
	if (value) startCamera();
	else stopCamera();
});

onUnmounted(stopCamera);
</script>
