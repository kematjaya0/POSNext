<template>
	<Dialog v-model="show" :options="{ size: 'lg' }">
		<template #body>
			<div class="p-6">
				<div class="flex items-start gap-4">
					<div
						:class="[
							'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
							rejected ? 'bg-red-100' : 'bg-amber-100',
						]"
					>
						<FeatherIcon
							:name="rejected ? 'x-circle' : 'clock'"
							:class="['h-6 w-6', rejected ? 'text-red-600' : 'text-amber-600']"
						/>
					</div>

					<div class="min-w-0 flex-1">
						<h3 class="text-lg font-semibold text-gray-900">
							{{ rejected ? __("Approval Ditolak") : __("Menunggu Approval") }}
						</h3>

						<p class="mt-1 text-base text-gray-600">
							{{ headline }}
						</p>

						<div class="mt-4 space-y-2 rounded-lg bg-gray-50 p-3 text-base">
							<div class="flex justify-between gap-4">
								<span class="text-gray-500">{{ __("Nomor Draft") }}</span>
								<span class="font-medium text-gray-900">{{ info.name }}</span>
							</div>
							<div v-if="info.max_discount_percent" class="flex justify-between gap-4">
								<span class="text-gray-500">{{ __("Diskon Terdalam") }}</span>
								<span class="font-medium text-gray-900">
									{{ Number(info.max_discount_percent).toFixed(2) }}%
								</span>
							</div>
							<div v-if="!rejected && info.pending_role" class="flex justify-between gap-4">
								<span class="text-gray-500">{{ __("Menunggu") }}</span>
								<span class="font-medium text-gray-900">{{ info.pending_role }}</span>
							</div>
							<div v-if="!rejected && info.required_role" class="flex justify-between gap-4">
								<span class="text-gray-500">{{ __("Sampai Dengan") }}</span>
								<span class="font-medium text-gray-900">{{ info.required_role }}</span>
							</div>
							<div v-if="rejected && info.rejection_reason" class="flex justify-between gap-4">
								<span class="text-gray-500">{{ __("Alasan") }}</span>
								<span class="font-medium text-red-600">{{ info.rejection_reason }}</span>
							</div>
						</div>

						<p class="mt-4 text-sm text-gray-500">
							{{
								rejected
									? __(
											"Ubah harga jual kembali ke tingkat yang disetujui, atau hubungi atasan yang menolak."
									  )
									: __(
											"Transaksi tersimpan sebagai draft dan TIDAK menambah stok keluar. Struk baru bisa dicetak setelah approval selesai — dokumen akan ter-submit otomatis."
									  )
							}}
						</p>
					</div>
				</div>

				<div class="mt-6 flex flex-wrap justify-end gap-2">
					<Button
						v-if="!rejected"
						:loading="checking"
						variant="subtle"
						@click="checkStatus"
					>
						{{ __("Cek Status") }}
					</Button>
					<Button variant="solid" @click="close">
						{{ __("Mengerti") }}
					</Button>
				</div>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
/**
 * Ditampilkan ketika penjualan di bawah harga jual ditahan oleh approval
 * berjenjang (lihat nextend/sales_approval).
 *
 * Kasir TIDAK boleh melihat dialog sukses atau mencetak struk di sini:
 * invoice masih draft, stok belum keluar, dan pembayaran belum tercatat
 * sebagai transaksi selesai.
 */
import { computed, ref } from "vue";
import { Dialog, Button, FeatherIcon, createResource } from "frappe-ui";

const props = defineProps({
	modelValue: { type: Boolean, default: false },
	info: { type: Object, default: () => ({}) },
});

const emit = defineEmits(["update:modelValue", "approved"]);

const checking = ref(false);

const show = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

const rejected = computed(() => Boolean(props.info?.approval_rejected));

const headline = computed(() => {
	if (rejected.value) {
		return __("Penjualan ini ditolak dan tidak bisa diselesaikan apa adanya.");
	}
	return __("Harga jual di bawah harga standar, jadi transaksi perlu persetujuan atasan.");
});

const statusResource = createResource({
	url: "nextend.sales_approval.pos_next_bridge.get_pos_approval_status",
	auto: false,
});

async function checkStatus() {
	if (!props.info?.name) return;

	checking.value = true;
	try {
		const status = await statusResource.submit({ invoice_name: props.info.name });
		const data = status?.message || status;

		if (data?.invoice_submitted) {
			emit("approved", props.info.name);
			close();
			return;
		}

		if (data?.status === "Rejected") {
			props.info.approval_rejected = true;
			props.info.rejection_reason = data.rejection_reason;
			return;
		}

		props.info.pending_role = data?.pending_role || props.info.pending_role;
	} finally {
		checking.value = false;
	}
}

function close() {
	show.value = false;
}
</script>
