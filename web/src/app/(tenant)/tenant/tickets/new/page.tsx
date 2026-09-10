"use client";

import { useState } from "react";
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase/client";
import { useCurrentUser } from "@/lib/auth/AuthProvider";
import { CATEGORY_TO_PROVIDER_ID, type TicketCategory, type TicketPriority } from "@hay-service-desk/shared";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";

export default function NewTicketPage() {
  const { uid, profile } = useCurrentUser();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("cleaning");
  const [priority, setPriority] = useState<TicketPriority>("low");
  const [files, setFiles] = useState<FileList | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!uid || !profile) {
      setError("Profile not loaded yet.");
      return;
    }

    setSubmitting(true);
    try {
      const ticketRef = doc(collection(db, "Ticket"));

      const photoUrls: string[] = [];
      if (files) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const photoRef = ref(storage, `ticketPhotos/${uid}/${ticketRef.id}/${i}-${file.name}`);
          await uploadBytes(photoRef, file);
          photoUrls.push(await getDownloadURL(photoRef));
        }
      }

      await setDoc(ticketRef, {
        tenantId: uid,
        buildingId: profile.buildingId,
        unit: profile.unit,
        providerId: CATEGORY_TO_PROVIDER_ID[category],
        category,
        title,
        description,
        photos: photoUrls,
        priority,
        workflowStatus: "submitted",
        submittedAt: serverTimestamp(),
        acknowledgedAt: null,
        acknowledgedBy: null,
        resolvedAt: null,
        resolvedBy: null,
        firstBreachedAt: null,
      });

      setTitle("");
      setDescription("");
      setFiles(null);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold text-brand-primary">New Ticket</h1>
      <Card className="mt-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <Textarea
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
          <Select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
            <option value="cleaning">Cleaning</option>
            <option value="maintenance">Maintenance</option>
          </Select>
          <Select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
          <Input type="file" accept="image/*" multiple onChange={(e) => setFiles(e.target.files)} />
          <Button type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit ticket"}
          </Button>
        </form>
        {success && <p className="mt-3 text-sm text-brand-success">Ticket submitted.</p>}
        {error && <p className="mt-3 text-sm text-brand-error">{error}</p>}
      </Card>
    </main>
  );
}
