import { createResource } from "frappe-ui";
import { computed, ref } from "vue";

export const shiftState = ref({
	pos_opening_shift: null,
	pos_profile: null,
	company: null,
	isOpen: false,
	/** SPG (nextend POS Order): runs on a cashier's shift, saves orders instead of paying */
	spgMode: false,
	/** Initial elapsed ms at the moment shift data was received from server */
	_initialElapsedMs: 0,
	/** Local timestamp (Date.now()) when shift data was received */
	_receivedAt: 0,
});

/**
 * Apply a check_opening_shift-shaped response to shiftState. For an SPG
 * (nextend override) the response may be `{spg_mode: true}` without a shift:
 * no shift picked yet, so the SPG shift picker is shown instead of the
 * opening dialog.
 */
export function applyShiftData(data) {
	if (data?.pos_opening_shift) {
		// Compute initial elapsed time using server timestamps
		// (avoids timezone mismatch between server and browser)
		let initialElapsedMs = 0;
		if (data.server_now && data.pos_opening_shift?.period_start_date) {
			const serverNow = new Date(data.server_now).getTime();
			const shiftStart = new Date(data.pos_opening_shift.period_start_date).getTime();
			initialElapsedMs = Math.max(0, serverNow - shiftStart);
		}
		shiftState.value = {
			pos_opening_shift: data.pos_opening_shift,
			pos_profile: data.pos_profile,
			company: data.company,
			isOpen: true,
			spgMode: !!data.spg_mode,
			_initialElapsedMs: initialElapsedMs,
			_receivedAt: Date.now(),
		};
		// Store in localStorage for offline support
		localStorage.setItem(
			"pos_shift_data",
			JSON.stringify({
				...data,
				_initialElapsedMs: initialElapsedMs,
				_receivedAt: Date.now(),
			})
		);
	} else {
		shiftState.value = {
			pos_opening_shift: null,
			pos_profile: null,
			company: null,
			isOpen: false,
			spgMode: !!data?.spg_mode,
			_initialElapsedMs: 0,
			_receivedAt: 0,
		};
		localStorage.removeItem("pos_shift_data");
	}
}

export function useShift() {
	// Check for existing open shift
	const checkOpeningShift = createResource({
		url: "pos_next.api.shifts.check_opening_shift",
		auto: false,
		onSuccess: applyShiftData,
		onError(error) {
			console.error("Error checking opening shift:", error);
			// Try to load from localStorage
			const cachedData = localStorage.getItem("pos_shift_data");
			if (cachedData) {
				try {
					const data = JSON.parse(cachedData);
					shiftState.value = {
						pos_opening_shift: data.pos_opening_shift,
						pos_profile: data.pos_profile,
						company: data.company,
						isOpen: true,
						spgMode: !!data.spg_mode,
						_initialElapsedMs: data._initialElapsedMs || 0,
						_receivedAt: data._receivedAt || Date.now(),
					};
				} catch (e) {
					console.error("Error parsing cached shift data:", e);
				}
			}
		},
	});

	// Get opening dialog data (POS profiles, payment methods, etc.)
	const getOpeningDialogData = createResource({
		url: "pos_next.api.shifts.get_opening_dialog_data",
		auto: false,
	});

	// Create new opening shift
	const createOpeningShift = createResource({
		url: "pos_next.api.shifts.create_opening_shift",
		makeParams({ pos_profile, company, balance_details }) {
			return {
				pos_profile,
				company,
				balance_details: JSON.stringify(balance_details),
			};
		},
		onSuccess(data) {
			shiftState.value = {
				pos_opening_shift: data.pos_opening_shift,
				pos_profile: data.pos_profile,
				company: data.company,
				isOpen: true,
				spgMode: false,
				_initialElapsedMs: 0,
				_receivedAt: Date.now(),
			};
			// Store in localStorage
			localStorage.setItem(
				"pos_shift_data",
				JSON.stringify({
					...data,
					_initialElapsedMs: 0,
					_receivedAt: Date.now(),
				})
			);
		},
		onError(error) {
			console.error("Error creating opening shift:", error);
		},
	});

	// Get closing shift data
	const getClosingShiftData = createResource({
		url: "pos_next.api.shifts.get_closing_shift_data",
		makeParams({ opening_shift }) {
			return { opening_shift };
		},
		auto: false,
	});

	// Submit closing shift
	const submitClosingShift = createResource({
		url: "pos_next.api.shifts.submit_closing_shift",
		makeParams({ closing_shift }) {
			return { closing_shift: JSON.stringify(closing_shift) };
		},
		onSuccess() {
			shiftState.value = {
				pos_opening_shift: null,
				pos_profile: null,
				company: null,
				isOpen: false,
				spgMode: false,
				_initialElapsedMs: 0,
				_receivedAt: 0,
			};
			localStorage.removeItem("pos_shift_data");
		},
		onError(error) {
			console.error("Error submitting closing shift:", error);
		},
	});

	// Computed properties
	const hasOpenShift = computed(() => shiftState.value.isOpen);
	const currentShift = computed(() => shiftState.value.pos_opening_shift);
	const currentProfile = computed(() => shiftState.value.pos_profile);
	const currentCompany = computed(() => shiftState.value.company);
	const isSpgMode = computed(() => shiftState.value.spgMode);

	return {
		// State
		shiftState,
		hasOpenShift,
		currentShift,
		currentProfile,
		currentCompany,
		isSpgMode,

		// Resources
		checkOpeningShift,
		getOpeningDialogData,
		createOpeningShift,
		getClosingShiftData,
		submitClosingShift,
	};
}
