"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { callMutation } from "@/lib/api";
import type { MonthlyReport } from "@hay-service-desk/shared";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";

const PROVIDERS = [
  { id: "provider-cleaning", name: "Cleaning" },
  { id: "provider-maintenance", name: "Maintenance" },
];

interface ReportRow {
  id: string;
  data: MonthlyReport;
}

export default function AdminReportsPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [providerId, setProviderId] = useState(PROVIDERS[0].id);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportRow | null>(null);

  useEffect(() => {
    const q = query(collection(db, "MonthlyReport"), orderBy("generatedAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setReports(snap.docs.map((d) => ({ id: d.id, data: d.data() as MonthlyReport })));
    });
    return unsub;
  }, []);

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
      await callMutation("generateMonthlyReport", { providerId, month, year });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold text-brand-primary">Monthly Reports</h1>

      <Card className="mt-4">
        <div className="flex flex-wrap items-end gap-2">
          <Select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={1}
            max={12}
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="w-20"
            placeholder="Month"
          />
          <Input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-24"
            placeholder="Year"
          />
          <Button onClick={handleGenerate} disabled={generating} className="px-3 py-1.5">
            {generating ? "Generating..." : "Generate Report"}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-brand-error">{error}</p>}
      </Card>

      <Card className="mt-4">
        {reports.length === 0 ? (
          <p className="py-6 text-center text-sm text-brand-primary/50">No reports generated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-brand-border text-brand-primary/70">
                  <th className="py-2 font-semibold">Provider</th>
                  <th className="py-2 font-semibold">Period</th>
                  <th className="py-2 font-semibold">Total</th>
                  <th className="py-2 font-semibold">Open</th>
                  <th className="py-2 font-semibold">Breached</th>
                  <th className="py-2 font-semibold">Avg Resolve (min)</th>
                  <th className="py-2 font-semibold">Generated</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const active = selected?.id === r.id;
                  return (
                    <tr
                      key={r.id}
                      className={`cursor-pointer border-b border-brand-border transition-colors hover:bg-brand-cream/60 ${active ? "bg-brand-cream" : ""}`}
                      onClick={() => setSelected(active ? null : r)}
                    >
                      <td className="py-2.5 font-medium capitalize">{r.data.providerId.replace("provider-", "")}</td>
                      <td className="py-2.5">
                        {r.data.month}/{r.data.year}
                      </td>
                      <td className="py-2.5">{r.data.totalTickets}</td>
                      <td className="py-2.5">{r.data.openCount}</td>
                      <td className="py-2.5">
                        {r.data.breachedCount > 0 ? (
                          <span className="font-semibold text-brand-error">{r.data.breachedCount}</span>
                        ) : (
                          r.data.breachedCount
                        )}
                      </td>
                      <td className="py-2.5">{r.data.avgResolveTimeMinutes.toFixed(1)}</td>
                      <td className="py-2.5 text-brand-primary/70">
                        {r.data.generatedAt.toDate().toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <Card className="mt-4">
          <h2 className="font-semibold text-brand-primary capitalize">
            {selected.data.providerId.replace("provider-", "")} — {selected.data.month}/{selected.data.year}
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-brand-primary/60">Total tickets</dt>
              <dd className="font-semibold">{selected.data.totalTickets}</dd>
            </div>
            <div>
              <dt className="text-brand-primary/60">Open</dt>
              <dd className="font-semibold">{selected.data.openCount}</dd>
            </div>
            <div>
              <dt className="text-brand-primary/60">Breached</dt>
              <dd className={`font-semibold ${selected.data.breachedCount > 0 ? "text-brand-error" : ""}`}>
                {selected.data.breachedCount}
              </dd>
            </div>
            <div>
              <dt className="text-brand-primary/60">Avg resolve time</dt>
              <dd className="font-semibold">{selected.data.avgResolveTimeMinutes.toFixed(1)} min</dd>
            </div>
            <div>
              <dt className="text-brand-primary/60">Generated by</dt>
              <dd className="font-mono text-xs">{selected.data.generatedBy.slice(0, 8)}</dd>
            </div>
            <div>
              <dt className="text-brand-primary/60">Generated at</dt>
              <dd>{selected.data.generatedAt.toDate().toLocaleString()}</dd>
            </div>
          </dl>
        </Card>
      )}
    </main>
  );
}
