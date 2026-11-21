<template>
	<Dialog v-model="show" :options="{ title: __('Pemakaian Tinta'), size: '3xl' }">
		<template #body-content>
			<div class="flex flex-col gap-3 text-start">
				<div class="flex items-center gap-2">
					<select
						v-model="warehouse"
						class="flex-1 h-8 text-sm border border-gray-300 rounded px-2"
						:aria-label="__('Gudang')"
					>
						<option v-for="wh in warehouses" :key="wh" :value="wh">{{ wh }}</option>
					</select>
					<Button variant="subtle" :loading="loadingList" @click="loadUploads">
						{{ __("Refresh") }}
					</Button>
				</div>

				<!-- New upload -->
				<div class="border border-gray-200 rounded-lg p-3 flex flex-col gap-2" data-test="upload">
					<div class="text-sm font-semibold text-gray-900">{{ __("Upload Baru") }}</div>
					<div class="flex flex-wrap items-end gap-2">
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Format") }}
							<select
								v-model="format"
								class="h-8 text-sm border border-gray-300 rounded px-2"
								:aria-label="__('Format')"
							>
								<option :value="MANUAL">{{ __("Template Manual") }}</option>
								<option v-for="machine in formats" :key="machine.name" :value="machine.name">
									{{ formatLabel(machine) }}
								</option>
							</select>
						</label>
						<template v-if="format === MANUAL">
							<label class="text-xs text-gray-600 flex flex-col gap-1">
								{{ __("Brand") }}
								<select
									v-model="brand"
									class="h-8 text-sm border border-gray-300 rounded px-2"
									:aria-label="__('Brand')"
								>
									<option :value="null" disabled>{{ __("Pilih brand") }}</option>
									<option v-for="name in brands" :key="name" :value="name">
										{{ brandLabel(name) }}
									</option>
								</select>
							</label>
						</template>
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Periode Dari") }}
							<input
								v-model="periodeDari"
								type="date"
								class="h-8 text-sm border border-gray-300 rounded px-2"
							/>
						</label>
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Periode Sampai") }}
							<input
								v-model="periodeSampai"
								type="date"
								class="h-8 text-sm border border-gray-300 rounded px-2"
							/>
						</label>
						<template v-if="format === MANUAL">
							<a
								v-if="brand !== null"
								:href="templateUrl"
								class="h-8 inline-flex items-center px-3 text-sm rounded bg-gray-100 hover:bg-gray-200 text-gray-800"
							>
								{{ __("Download Template") }}
							</a>
							<span
								v-else
								class="h-8 inline-flex items-center px-3 text-sm rounded bg-gray-50 text-gray-400"
							>
								{{ __("Download Template") }}
							</span>
						</template>
						<input
							ref="fileInput"
							type="file"
							:accept="format === MANUAL ? '.xlsx,.csv' : '.xlsx,.xls,.csv'"
							class="text-sm"
							@change="onFileChosen"
						/>
					</div>
					<p v-if="format === MANUAL && !brands.length && !loadingList" class="text-xs text-yellow-700">
						{{ __("Belum ada tinta add on yang tercatat di gudang ini.") }}
					</p>
					<p v-if="format === MANUAL" class="text-xs text-gray-500">
						{{
							__(
								"Isi kolom Qty Keluar dengan total pemakaian periode ini dalam satuan di template. Baris kosong dianggap tidak dipakai. Salah qty? Batalkan upload yang masih Diajukan lalu upload ulang; yang sudah disetujui minta dibatalkan Stock Manager."
							)
						}}
					</p>
					<template v-else>
						<p class="text-xs text-gray-500">
							{{
								__(
									"Isi periode pemakaian, lalu pilih file asli dari mesin. Hanya job di periode itu yang diproses. Upload sore saat closing, setelah semua penjualan hari ini masuk."
								)
							}}
						</p>
						<p v-if="selectedFormat && !cutsStock(selectedFormat)" class="text-xs text-blue-700">
							{{ __("Format ini hanya mencatat job dan cost. Stok tinta brand ini tetap lewat Template Manual.") }}
						</p>
					</template>
					<p v-if="error" class="text-sm text-red-600">{{ error }}</p>
					<div v-if="previewing" class="text-sm text-gray-500">{{ __("Membaca file...") }}</div>
				</div>

				<!-- Preview: template manual -->
				<div
					v-if="preview && format === MANUAL"
					class="border border-gray-200 rounded-lg p-3 flex flex-col gap-2"
				>
					<div class="flex flex-wrap items-center gap-3 text-sm">
						<span class="font-semibold">{{ __("Preview") }}</span>
						<span class="text-green-700">✓ {{ preview.summary.ok }} OK</span>
						<span class="text-yellow-700">⚠ {{ preview.summary.warning }} {{ __("peringatan") }}</span>
						<span class="text-red-700">✗ {{ preview.summary.error }} error</span>
					</div>
					<ul v-if="preview.errors.length" class="text-sm text-red-600 list-disc ps-5">
						<li v-for="message in preview.errors" :key="message">{{ message }}</li>
					</ul>
					<div v-if="preview.rows.length" class="max-h-72 overflow-y-auto">
						<table class="w-full text-xs">
							<thead class="text-gray-500 border-b border-gray-200">
								<tr>
									<th class="py-1 pe-2 text-start">{{ __("Baris") }}</th>
									<th class="py-1 pe-2 text-start">{{ __("Item") }}</th>
									<th class="py-1 pe-2 text-end">{{ __("Qty") }}</th>
									<th class="py-1 text-start">{{ __("Status") }}</th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="row in preview.rows"
									:key="row.row_no"
									class="border-b border-gray-50 align-top"
									:class="ROW_CLASS[row.status]"
								>
									<td class="py-1 pe-2">{{ row.row_no }}</td>
									<td class="py-1 pe-2">
										<div class="font-medium text-gray-900">{{ row.item_code || "-" }}</div>
										<div class="text-gray-500">{{ row.item_name || "" }}</div>
									</td>
									<td class="py-1 pe-2 text-end whitespace-nowrap">
										{{ row.qty === false ? "?" : row.qty }} {{ row.stock_uom || "" }}
									</td>
									<td class="py-1">
										<span v-if="row.status === 'ok'">✓</span>
										<div v-for="message in row.messages" :key="message">
											{{ row.status === "error" ? "✗" : "⚠" }} {{ message }}
										</div>
									</td>
								</tr>
							</tbody>
						</table>
					</div>
					<div class="flex justify-end gap-2">
						<Button variant="subtle" @click="resetUpload">{{ __("Batal") }}</Button>
						<Button
							theme="blue"
							variant="solid"
							:disabled="!preview.can_submit"
							:loading="submitting"
							@click="submitUpload"
						>
							{{ __("Ajukan") }}
						</Button>
					</div>
					<p v-if="!preview.can_submit" class="text-xs text-red-600">
						{{ __("Perbaiki error di file lalu upload ulang.") }}
					</p>
				</div>

				<!-- Preview: file mesin -->
				<div
					v-else-if="preview"
					class="border border-gray-200 rounded-lg p-3 flex flex-col gap-2"
				>
					<div class="flex flex-wrap items-center gap-2 text-sm">
						<span class="font-semibold">{{ __("Preview") }}</span>
						<span class="text-gray-700">{{ preview.format.name }}</span>
						<span class="text-gray-500">
							{{ processLabel(preview.format) }} · {{ __("versi {0}", [preview.format.versi]) }}
						</span>
					</div>
					<p v-if="!cutsStock(preview.format)" class="text-xs text-blue-700">
						{{ __("Dicatat saja, stok tidak berubah") }}
					</p>
					<ul v-if="preview.errors.length" class="text-sm text-red-600 list-disc ps-5">
						<li v-for="message in preview.errors" :key="message">{{ message }}</li>
					</ul>

					<div v-if="preview.sheet && preview.sheet.columns.length" class="overflow-x-auto text-xs">
						<div class="font-semibold text-gray-900 mb-1">{{ __("Isi file yang diproses") }}</div>
						<table class="border-collapse whitespace-nowrap" data-test="sheet">
							<tbody>
								<tr>
									<th class="border border-gray-200 bg-gray-100 px-2 py-1"></th>
									<th
										v-for="column in preview.sheet.columns"
										:key="column.huruf"
										class="border border-gray-200 bg-gray-100 px-2 py-1 font-medium text-gray-500"
									>
										{{ column.huruf }}
									</th>
								</tr>
								<tr>
									<td class="border border-gray-200 bg-gray-100 px-2 py-1"></td>
									<td
										v-for="column in preview.sheet.columns"
										:key="column.huruf"
										class="border border-gray-200 bg-green-50 px-2 py-1 font-semibold text-gray-900"
									>
										{{ column.peran.join(", ") }}
									</td>
								</tr>
								<tr>
									<td class="border border-gray-200 bg-gray-100 px-2 py-1 text-center text-gray-500">
										{{ preview.sheet.baris_header }}
									</td>
									<td
										v-for="column in preview.sheet.columns"
										:key="column.huruf"
										class="border border-gray-200 px-2 py-1 font-semibold"
									>
										{{ column.header }}
									</td>
								</tr>
								<template v-for="(row, index) in preview.sheet.rows" :key="row.row_no">
									<tr v-if="row.row_no > previousRow(index) + 1">
										<td class="border border-gray-200 bg-gray-100 px-2 text-center text-gray-500">…</td>
										<td :colspan="preview.sheet.columns.length" class="border-y border-gray-200"></td>
									</tr>
									<tr>
										<td class="border border-gray-200 bg-gray-100 px-2 py-1 text-center text-gray-500">
											{{ row.row_no }}
										</td>
										<td
											v-for="(cell, cellIndex) in row.cells"
											:key="cellIndex"
											class="border border-gray-200 px-2 py-1 align-top"
										>
											<div class="whitespace-pre">{{ String(cell.nilai ?? "").trim() }}</div>
											<div v-if="cell.hasil" class="whitespace-pre text-[11px] text-gray-500">→ {{ cell.hasil }}</div>
										</td>
									</tr>
								</template>
							</tbody>
						</table>
					</div>

					<div class="flex flex-wrap gap-3 text-sm">
						<span>{{ __("{0} job baru", [preview.counts.baru]) }}</span>
						<span>{{ __("{0} kaleng", [preview.counts.kaleng]) }}</span>
						<span v-if="preview.counts.punya_cost" class="font-semibold">
							{{ __("Cost {0}", [money(preview.counts.cost)]) }}
						</span>
						<span class="text-gray-500">
							{{ __("{0} sudah pernah diunggah", [preview.counts.sudah_diimpor]) }}
						</span>
						<span v-if="preview.counts.di_luar_periode" class="text-gray-500">
							{{ __("{0} di luar periode", [preview.counts.di_luar_periode]) }}
						</span>
						<span class="text-gray-500">
							{{ __("{0} sebelum tanggal hitung", [preview.counts.sebelum_mulai]) }}
						</span>
						<span v-if="preview.counts.penyesuaian" class="text-gray-500">
							{{ __("{0} penyesuaian", [preview.counts.penyesuaian]) }}
						</span>
						<span
							v-if="preview.periode.dari"
							class="text-gray-500"
						>
							{{ preview.periode.dari }} – {{ preview.periode.sampai }}
						</span>
					</div>

					<div v-if="preview.rows.length" class="max-h-72 overflow-y-auto">
						<table class="w-full text-xs">
							<thead class="text-gray-500 border-b border-gray-200">
								<tr>
									<th class="py-1 pe-2 text-start">{{ __("Kode") }}</th>
									<th class="py-1 pe-2 text-start">{{ __("Item") }}</th>
									<th class="py-1 pe-2 text-end">{{ __("Jumlah Mesin") }}</th>
									<th class="py-1 pe-2 text-end">{{ __("Faktor") }}</th>
									<th class="py-1 pe-2 text-end">{{ __("Qty Stok") }}</th>
									<th class="py-1 text-start">{{ __("Status") }}</th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="row in preview.rows"
									:key="row.row_no"
									class="border-b border-gray-50 align-top"
									:class="ROW_CLASS[row.status]"
								>
									<td class="py-1 pe-2">{{ row.kode }}</td>
									<td class="py-1 pe-2">
										<div class="font-medium text-gray-900">{{ row.item_code || "-" }}</div>
										<div class="text-gray-500">{{ row.item_name || "" }}</div>
									</td>
									<td class="py-1 pe-2 text-end whitespace-nowrap">
										{{ row.jumlah_mesin }} {{ row.satuan_mesin || "" }}
									</td>
									<td class="py-1 pe-2 text-end">{{ row.faktor || "-" }}</td>
									<td class="py-1 pe-2 text-end whitespace-nowrap">
										{{ row.qty === null ? "-" : `${row.qty} ${row.stock_uom || ""}` }}
									</td>
									<td class="py-1">
										<span v-if="row.status === 'ok'">✓</span>
										<div v-for="message in row.messages" :key="message">
											{{ row.status === "error" ? "✗" : "⚠" }} {{ message }}
										</div>
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<div v-if="preview.jobs.length" class="space-y-2" data-test="cek-nota">
						<div>
							<div class="font-semibold text-gray-900">{{ __("Cek Nota per Job") }}</div>
							<div class="text-xs text-gray-500">
								{{ __("Setiap cat yang diaduk mesin dicari notanya lewat No. Job yang diketik di nota.") }}
							</div>
						</div>
						<ul class="text-xs space-y-0.5" data-test="keterangan-status">
							<li v-for="item in matchLegend" :key="item.status">
								<span class="font-semibold text-gray-900">{{ __(item.status) }}</span>
								<span class="text-gray-500"> ({{ item.count }})</span>: {{ __(item.text) }}
							</li>
						</ul>
						<div class="max-h-72 overflow-y-auto">
							<table class="w-full text-xs">
								<thead class="text-gray-500 border-b border-gray-200">
									<tr>
										<th class="py-1 pe-2 text-start">{{ __("No. Job") }}</th>
										<th class="py-1 pe-2 text-start">{{ __("Waktu") }}</th>
										<th class="py-1 pe-2 text-start">{{ __("Warna") }}</th>
										<th class="py-1 pe-2 text-end">{{ __("Kaleng") }}</th>
										<th v-if="preview.counts.punya_cost" class="py-1 pe-2 text-end">{{ __("Cost") }}</th>
										<th class="py-1 pe-2 text-start">{{ __("Nota") }}</th>
										<th class="py-1 text-start">{{ __("Status") }}</th>
									</tr>
								</thead>
								<tbody>
									<tr
										v-for="job in preview.jobs"
										:key="job.no_job"
										class="border-b border-gray-50"
										:class="MATCH_CLASS[job.status_cocok] || ''"
									>
										<td class="py-1 pe-2">{{ job.no_job }}</td>
										<td class="py-1 pe-2 whitespace-nowrap">{{ job.waktu }}</td>
										<td class="py-1 pe-2">{{ job.warna }}</td>
										<td class="py-1 pe-2 text-end">{{ job.kaleng }}</td>
										<td v-if="preview.counts.punya_cost" class="py-1 pe-2 text-end whitespace-nowrap">
											{{ job.biaya === null ? "-" : money(job.biaya) }}
										</td>
										<td class="py-1 pe-2">{{ job.sales_invoice || "-" }}</td>
										<td class="py-1">{{ __(job.status_cocok) }}</td>
									</tr>
								</tbody>
							</table>
						</div>
					</div>

					<div v-if="preview.nota_kurang.length" class="text-xs">
						<div class="font-semibold text-gray-900 mb-1">{{ __("Nota Belum Terpenuhi") }}</div>
						<div v-for="nota in preview.nota_kurang" :key="nota.sales_invoice">
							{{ nota.sales_invoice }} · {{ nota.no_job }} · {{ __("qty {0}, terisi {1}", [nota.qty, nota.kaleng]) }}
						</div>
					</div>

					<div v-if="preview.nota_tanpa_job.length" class="text-xs">
						<div class="font-semibold text-gray-900 mb-1">{{ __("Nota Tanpa Job di File") }}</div>
						<div v-for="nota in preview.nota_tanpa_job" :key="nota.no_job">
							{{ nota.sales_invoice }} · {{ nota.no_job }} · {{ nota.item_code }} · {{ nota.posting_date }}
						</div>
					</div>

					<div class="flex justify-end gap-2">
						<Button variant="subtle" @click="resetUpload">{{ __("Batal") }}</Button>
						<Button
							theme="blue"
							variant="solid"
							:disabled="!preview.can_submit"
							:loading="submitting"
							@click="submitUpload"
						>
							{{ __("Ajukan") }}
						</Button>
					</div>
					<ul v-if="!preview.can_submit" class="text-xs text-red-600 list-disc ps-5" data-test="alasan">
						<li v-for="reason in preview.alasan" :key="reason">{{ reason }}</li>
					</ul>
				</div>

				<!-- History -->
				<div class="flex flex-col gap-2">
					<div class="text-sm font-semibold text-gray-900">{{ __("Riwayat Upload") }}</div>
					<div v-if="!uploads.length" class="text-sm text-gray-500">
						{{ __("Belum ada upload untuk gudang ini.") }}
					</div>
					<div
						v-for="upload in uploads"
						:key="upload.name"
						class="border border-gray-200 rounded-lg p-2 flex items-start justify-between gap-2"
					>
						<div class="min-w-0">
							<div class="text-sm font-semibold text-gray-900">{{ upload.name }}</div>
							<div class="text-xs text-gray-500">
								{{ brandLabel(upload.brand || "") }} ·
								{{ upload.periode_dari }} – {{ upload.periode_sampai }} ·
								<template v-if="upload.sumber === 'File Mesin'">
									{{ __("{0} job mesin", [upload.rows]) }}
								</template>
								<template v-else>
									{{ __("{0} tinta", [upload.rows]) }}
								</template>
								<template v-if="upload.pending">
									· {{ __("{0} pending", [upload.pending]) }}
								</template>
							</div>
							<div v-if="upload.alasan_tolak" class="text-xs text-red-600">
								{{ upload.alasan_tolak }}
							</div>
						</div>
						<div class="flex flex-col items-end gap-1">
							<span
								class="text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap"
								:class="STATUS_CLASS[upload.status] || 'bg-gray-100 text-gray-700'"
							>
								{{ upload.status }}
							</span>
							<Button
								v-if="upload.can_cancel"
								variant="subtle"
								size="sm"
								:loading="cancelling === upload.name"
								@click="cancelUpload(upload.name)"
							>
								{{ __("Batalkan") }}
							</Button>
						</div>
					</div>
				</div>

				<!-- Laporan -->
				<div class="border border-gray-200 rounded-lg p-3 flex flex-col gap-2" data-test="laporan">
					<div class="text-sm font-semibold text-gray-900">{{ __("Laporan Pemakaian Tinta") }}</div>
					<div class="flex flex-wrap items-end gap-2">
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Dari") }}
							<input v-model="reportDari" type="date" class="h-8 text-sm border border-gray-300 rounded px-2" />
						</label>
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Sampai") }}
							<input v-model="reportSampai" type="date" class="h-8 text-sm border border-gray-300 rounded px-2" />
						</label>
						<label class="text-xs text-gray-600 flex flex-col gap-1">
							{{ __("Brand") }}
							<select
								v-model="reportBrand"
								class="h-8 text-sm border border-gray-300 rounded px-2"
								:aria-label="__('Brand Laporan')"
							>
								<option value="">{{ __("Semua") }}</option>
								<option v-for="name in reportBrands" :key="name" :value="name">{{ name }}</option>
							</select>
						</label>
						<Button variant="subtle" :loading="loadingReport" @click="loadReport">
							{{ __("Tampilkan") }}
						</Button>
					</div>
					<p v-if="reportError" class="text-sm text-red-600">{{ reportError }}</p>
					<p v-else-if="report && !report.brands.length" class="text-sm text-gray-500">
						{{ __("Belum ada pemakaian tinta yang diunggah pada periode ini.") }}
					</p>
					<div
						v-for="entry in report?.brands || []"
						:key="entry.brand"
						class="border-t border-gray-100 pt-2 flex flex-col gap-2"
						data-test="laporan-brand"
					>
						<div class="flex flex-wrap items-center gap-3 text-sm">
							<span class="font-semibold text-gray-900">{{ entry.brand }}</span>
							<span class="text-gray-500">
								{{ entry.potong_stok ? __("memotong stok tinta") : __("dicatat saja") }}
							</span>
							<span>{{ __("{0} job", [entry.jobs]) }}</span>
							<span>{{ __("{0} kaleng", [entry.kaleng]) }}</span>
							<span class="font-semibold">
								{{ __("Cost {0}", [entry.punya_cost ? money(entry.cost) : "-"]) }}
							</span>
						</div>
						<table v-if="entry.tinta.length" class="w-full text-xs">
							<thead class="text-gray-500 border-b border-gray-200">
								<tr>
									<th class="py-1 pe-2 text-start">{{ __("Kode") }}</th>
									<th class="py-1 pe-2 text-start">{{ __("Item") }}</th>
									<th class="py-1 pe-2 text-end">{{ __("Jumlah Mesin") }}</th>
									<th class="py-1 pe-2 text-end">{{ __("Faktor") }}</th>
									<th class="py-1 pe-2 text-end">{{ __("Qty Stok") }}</th>
									<th class="py-1 text-end">{{ __("Job") }}</th>
								</tr>
							</thead>
							<tbody>
								<tr
									v-for="row in entry.tinta"
									:key="`${row.kode}-${row.item_code}-${row.faktor}`"
									class="border-b border-gray-50"
								>
									<td class="py-1 pe-2">{{ row.kode }}</td>
									<td class="py-1 pe-2">{{ row.item_name || row.item_code }}</td>
									<td class="py-1 pe-2 text-end whitespace-nowrap">
										{{ row.jumlah_mesin }} {{ row.satuan_mesin || "" }}
									</td>
									<td class="py-1 pe-2 text-end">{{ row.faktor }}</td>
									<td class="py-1 pe-2 text-end whitespace-nowrap">{{ row.qty_stok }} {{ row.stock_uom || "" }}</td>
									<td class="py-1 text-end">{{ row.jobs }}</td>
								</tr>
							</tbody>
						</table>
						<p v-else class="text-xs text-gray-500">
							{{ __("Tanpa rincian tinta: format brand ini hanya mencatat job.") }}
						</p>
						<details class="text-xs">
							<summary class="cursor-pointer text-gray-700">
								{{ __("Daftar job ({0})", [entry.daftar_job_total]) }}
							</summary>
							<table class="w-full mt-1">
								<thead class="text-gray-500 border-b border-gray-200">
									<tr>
										<th class="py-1 pe-2 text-start">{{ __("No. Job") }}</th>
										<th class="py-1 pe-2 text-start">{{ __("Waktu") }}</th>
										<th class="py-1 pe-2 text-start">{{ __("Warna") }}</th>
										<th class="py-1 pe-2 text-end">{{ __("Kaleng") }}</th>
										<th class="py-1 pe-2 text-end">{{ __("Cost") }}</th>
										<th class="py-1 pe-2 text-start">{{ __("Nota") }}</th>
										<th class="py-1 text-start">{{ __("No. Upload") }}</th>
									</tr>
								</thead>
								<tbody>
									<tr v-for="job in entry.daftar_job" :key="job.no_job" class="border-b border-gray-50">
										<td class="py-1 pe-2">{{ job.no_job }}</td>
										<td class="py-1 pe-2 whitespace-nowrap">{{ job.waktu }}</td>
										<td class="py-1 pe-2">{{ job.warna }}</td>
										<td class="py-1 pe-2 text-end">{{ job.kaleng }}</td>
										<td class="py-1 pe-2 text-end whitespace-nowrap">
											{{ job.cost === null ? "-" : money(job.cost) }}
										</td>
										<td class="py-1 pe-2">{{ job.sales_invoice || "-" }}</td>
										<td class="py-1">{{ job.impor }}</td>
									</tr>
								</tbody>
							</table>
						</details>
					</div>
				</div>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import { call } from "@/utils/apiWrapper";
import { Button, Dialog } from "frappe-ui";
import { computed, ref, watch } from "vue";

const METHOD = "nextend.pemakaian_tinta";
const IMPORT = "nextend.tinting_import.api";
const MANUAL = "__manual__";
const ROW_CLASS = { error: "bg-red-50", warning: "bg-yellow-50", ok: "" };
const MATCH_CLASS = { "Tanpa Nota": "bg-yellow-50", "Selisih Biaya": "bg-yellow-50" };
// Urutan = yang perlu dicek dulu di atas. Hanya status yang muncul di file ini yang ditampilkan.
const MATCH_STATUS = [
	["Tanpa Nota", "mesin mengaduk cat ini, tapi belum ada nota dengan No. Job-nya. Cek apakah belum dibayar, lupa atau salah ketik No. Job. Tidak menghalangi Ajukan."],
	["Selisih Biaya", "notanya ada, tapi cost tinta dari mesin berbeda dengan HPP tinta di nota. Cek formula atau tinta di nota."],
	["Menunggu Nota", "notanya masih draft, belum dibayar. Berubah sendiri setelah nota selesai."],
	["Cocok", "notanya ada dan cost tinta sama dengan nota."],
	["Tanpa Biaya", "notanya ada; file mesin ini tidak punya kolom cost, jadi biaya tidak dibandingkan."],
	["Penyesuaian", "koreksi atau tambahan tinta dari mesin, bukan penjualan baru, jadi tidak dicari notanya."],
];
const STATUS_CLASS = {
	Diajukan: "bg-blue-100 text-blue-700",
	Tercatat: "bg-blue-100 text-blue-700",
	Memproses: "bg-orange-100 text-orange-700",
	"Ada Pending": "bg-yellow-100 text-yellow-800",
	Selesai: "bg-green-100 text-green-700",
	Ditolak: "bg-red-100 text-red-700",
	Gagal: "bg-red-100 text-red-700",
	Dibatalkan: "bg-gray-200 text-gray-600",
};

const props = defineProps({
	modelValue: Boolean,
	warehouses: { type: Array, default: () => [] },
	defaultWarehouse: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue"]);

const show = ref(props.modelValue);
const warehouse = ref("");
const periodeDari = ref("");
const periodeSampai = ref("");
const fileUrl = ref("");
const fileInput = ref(null);
const preview = ref(null);
const previewing = ref(false);
const submitting = ref(false);
const error = ref("");
const uploads = ref([]);
const loadingList = ref(false);
const cancelling = ref("");
const brands = ref([]);
const formats = ref([]);
// null = not chosen yet; "" = tinta without a brand.
const brand = ref(null);
const format = ref(MANUAL);
const report = ref(null);
const reportDari = ref(today());
const reportSampai = ref(today());
const reportBrand = ref("");
const reportError = ref("");
const loadingReport = ref(false);
const matchLegend = computed(() => {
	const counts = {};
	for (const job of preview.value?.jobs || []) counts[job.status_cocok] = (counts[job.status_cocok] || 0) + 1;
	return MATCH_STATUS.filter(([status]) => counts[status]).map(([status, text]) => ({
		status,
		text,
		count: counts[status],
	}));
});
const reportBrands = computed(() => [...new Set(formats.value.map((machine) => machine.brand))].sort());

const selectedFormat = computed(() => formats.value.find((machine) => machine.name === format.value));

const templateUrl = computed(
	() =>
		`/api/method/${METHOD}.download_template?warehouse=${encodeURIComponent(warehouse.value)}` +
		`&brand=${encodeURIComponent(brand.value ?? "")}`
);

watch(
	() => props.modelValue,
	(value) => {
		show.value = value;
		if (value) {
			warehouse.value = props.warehouses.includes(props.defaultWarehouse)
				? props.defaultWarehouse
				: props.warehouses[0] || "";
			resetUpload();
			loadUploads();
		}
	}
);
watch(show, (value) => emit("update:modelValue", value));
watch(warehouse, () => {
	resetUpload();
	report.value = null;
	loadUploads();
});
watch(format, () => resetUpload());
watch([brand, periodeDari, periodeSampai], () => {
	if (!fileUrl.value || !periodeDari.value || !periodeSampai.value) return;
	if (format.value !== MANUAL || brand.value !== null) runPreview();
});

function today() {
	const now = new Date();
	const pad = (value) => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function loadReport() {
	loadingReport.value = true;
	reportError.value = "";
	try {
		report.value = await call(`${IMPORT}.report`, {
			warehouse: warehouse.value,
			periode_dari: reportDari.value,
			periode_sampai: reportSampai.value,
			brand: reportBrand.value || null,
		});
	} catch (err) {
		report.value = null;
		reportError.value = messageOf(err);
	} finally {
		loadingReport.value = false;
	}
}

function cutsStock(machine) {
	return machine?.jenis_proses === "Potong Stok";
}

function processLabel(machine) {
	return cutsStock(machine) ? __("memotong stok tinta") : __("dicatat saja, stok tidak berubah");
}

function formatLabel(machine) {
	return `${machine.name} — ${processLabel(machine)}`;
}

function money(value) {
	return Number(value || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

function previousRow(index) {
	return index ? preview.value.sheet.rows[index - 1].row_no : preview.value.sheet.baris_header;
}

function brandLabel(name) {
	return name || __("(Tanpa Brand)");
}

function messageOf(err) {
	return err?.messages?.join("\n") || err?.message || String(err);
}

async function loadUploads() {
	if (!warehouse.value) return;
	loadingList.value = true;
	try {
		const [list, names, machines] = await Promise.all([
			call(`${METHOD}.list_uploads`, { warehouse: warehouse.value }),
			call(`${METHOD}.get_template_brands`, { warehouse: warehouse.value }),
			call(`${IMPORT}.get_formats`, { warehouse: warehouse.value }),
		]);
		uploads.value = list || [];
		brands.value = names || [];
		formats.value = machines || [];
		if (!formats.value.some((machine) => machine.name === format.value)) format.value = MANUAL;
		if (!brands.value.includes(brand.value)) brand.value = brands.value.length === 1 ? brands.value[0] : null;
	} catch (err) {
		error.value = messageOf(err);
	} finally {
		loadingList.value = false;
	}
}

function resetUpload() {
	fileUrl.value = "";
	preview.value = null;
	error.value = "";
	if (fileInput.value) fileInput.value.value = "";
}

async function uploadFile(file) {
	const form = new FormData();
	form.append("file", file, file.name);
	form.append("is_private", "1");
	const response = await fetch("/api/method/upload_file", {
		method: "POST",
		body: form,
		headers: { "X-Frappe-CSRF-Token": window.csrf_token || "" },
	});
	const data = await response.json();
	if (!response.ok) throw new Error(data?.exception || __("Upload gagal"));
	return data.message.file_url;
}

async function onFileChosen(event) {
	const file = event.target.files?.[0];
	preview.value = null;
	error.value = "";
	if (!file) return;
	if (format.value === MANUAL && (brand.value === null || !periodeDari.value || !periodeSampai.value)) {
		error.value = __("Pilih brand dan isi periode dulu sebelum memilih file.");
		event.target.value = "";
		return;
	}
	if (format.value !== MANUAL && (!periodeDari.value || !periodeSampai.value)) {
		error.value = __("Isi periode dulu sebelum memilih file.");
		event.target.value = "";
		return;
	}
	previewing.value = true;
	try {
		fileUrl.value = await uploadFile(file);
	} catch (err) {
		error.value = messageOf(err);
		previewing.value = false;
		return;
	}
	await runPreview();
}

async function runPreview() {
	previewing.value = true;
	error.value = "";
	try {
		preview.value =
			format.value === MANUAL
				? await call(`${METHOD}.preview_upload`, {
						warehouse: warehouse.value,
						brand: brand.value,
						periode_dari: periodeDari.value,
						periode_sampai: periodeSampai.value,
						file_url: fileUrl.value,
					})
				: await call(`${IMPORT}.preview`, {
						format_name: format.value,
						warehouse: warehouse.value,
						file_url: fileUrl.value,
						periode_dari: periodeDari.value,
						periode_sampai: periodeSampai.value,
					});
	} catch (err) {
		preview.value = null;
		error.value = messageOf(err);
	} finally {
		previewing.value = false;
	}
}

async function submitUpload() {
	submitting.value = true;
	try {
		if (format.value === MANUAL) {
			await call(`${METHOD}.submit_upload`, {
				warehouse: warehouse.value,
				brand: brand.value,
				periode_dari: periodeDari.value,
				periode_sampai: periodeSampai.value,
				file_url: fileUrl.value,
			});
		} else {
			await call(`${IMPORT}.submit`, {
				format_name: format.value,
				warehouse: warehouse.value,
				file_url: fileUrl.value,
				periode_dari: periodeDari.value,
				periode_sampai: periodeSampai.value,
			});
		}
		resetUpload();
		periodeDari.value = "";
		periodeSampai.value = "";
		await loadUploads();
	} catch (err) {
		error.value = messageOf(err);
	} finally {
		submitting.value = false;
	}
}

async function cancelUpload(name) {
	if (!window.confirm(__("Batalkan upload {0}? Periodenya bisa diupload ulang.", [name]))) return;
	cancelling.value = name;
	error.value = "";
	try {
		await call(`${METHOD}.cancel_upload`, { name });
		await loadUploads();
	} catch (err) {
		error.value = messageOf(err);
	} finally {
		cancelling.value = "";
	}
}
</script>
