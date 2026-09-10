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
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-brand-border">
              <th className="py-2">Provider</th>
              <th className="py-2">Period</th>
              <th className="py-2">Total</th>
              <th className="py-2">Open</th>
              <th className="py-2">Breached</th>
              <th className="py-2">Avg Resolve (min)</th>
              <th className="py-2">Generated</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-b border-brand-border hover:bg-brand-cream"
                onClick={() => setSelected(r)}
              >
                <td className="py-2">{r.data.providerId}</td>
                <td className="py-2">
                  {r.data.month}/{r.data.year}
                </td>
                <td className="py-2">{r.data.totalTickets}</td>
                <td className="py-2">{r.data.openCount}</td>
                <td className="py-2">{r.data.breachedCount}</td>
                <td className="py-2">{r.data.avgResolveTimeMinutes.toFixed(1)}</td>
                <td className="py-2">{r.data.generatedAt.toDate().toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {reports.length === 0 && <p className="text-sm text-brand-primary/60">No reports generated yet.</p>}
      </Card>

      {selected && (
        <Card className="mt-4 text-sm">
          <h2 className="font-semibold">
            {selected.data.providerId} — {selected.data.month}/{selected.data.year}
          </h2>
          <pre className="mt-2">{JSON.stringify(selected.data, null, 2)}</pre>
        </Card>
      )}
    </main>
  );
}
