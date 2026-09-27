<template>
	<Dialog v-model="show" :options="{ title: __('Pilih Shift Kasir'), size: 'md' }">
		<template #body-content>
			<div class="flex flex-col gap-3">
				<p class="text-sm text-gray-600">
					{{ __("Pesanan akan dibayar di kasir dengan shift yang Anda pilih.") }}
				</p>

				<div v-if="loading" class="text-center py-6 text-sm text-gray-500">
					{{ __("Memuat shift...") }}
				</div>

				<div v-else-if="shifts.length === 0" class="text-center py-6">
					<p class="text-sm font-medium text-gray-900">
						{{ __("Belum ada shift kasir yang terbuka") }}
					</p>
					<p class="text-xs text-gray-500 mt-1">
						{{ __("Tunggu kasir membuka shift, lalu muat ulang.") }}
					</p>
				</div>

				<div v-else class="flex flex-col gap-2 max-h-96 overflow-y-auto">
					<button
						v-for="shift in shifts"
						:key="shift.name"
						type="button"
						:disabled="selecting"
						class="text-start bg-white border rounded-lg p-3 transition-all hover:border-blue-400"
						:class="
							shift.name === currentShiftName
								? 'border-blue-500 ring-1 ring-blue-500'
								: 'border-gray-200'
						"
						@click="selectShift(shift.name)"
					>
						<div class="text-sm font-semibold text-gray-900">
							{{ shift.cashier_name }}
						</div>
						<div class="text-xs text-gray-500 mt-0.5">
							{{ shift.pos_profile }} · {{ shift.name }}
						</div>
					</button>
				</div>
			</div>
		</template>
		<template #actions>
			<div class="flex justify-end">
				<Button :loading="loading" @click="loadShifts">{{ __("Muat Ulang") }}</Button>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { applyShiftData } from "@/composables/useShift";
import { useToast } from "@/composables/useToast";
import { call } from "@/utils/apiWrapper";
import { Button, Dialog } from "frappe-ui";
import { computed, ref, watch } from "vue";

const props = defineProps({
	modelValue: Boolean,
	currentShiftName: String,
});

const emit = defineEmits(["update:modelValue", "shift-selected"]);

const { showError } = useToast();

const show = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

const shifts = ref([]);
const loading = ref(false);
const selecting = ref(false);

async function loadShifts() {
	loading.value = true;
	try {
		shifts.value = (await call("nextend.pos_order.get_open_shifts")) || [];
	} catch (error) {
		showError(error?.messages?.[0] || error?.message || __("Gagal memuat shift kasir"));
	} finally {
		loading.value = false;
	}
}

async function selectShift(name) {
	selecting.value = true;
	try {
		applyShiftData(
			await call("nextend.pos_order.select_spg_shift", { pos_opening_shift: name })
		);
		show.value = false;
		emit("shift-selected");
	} catch (error) {
		showError(error?.messages?.[0] || error?.message || __("Gagal memilih shift"));
		await loadShifts();
	} finally {
		selecting.value = false;
	}
}

watch(show, (value) => {
	if (value) loadShifts();
});
</script>
