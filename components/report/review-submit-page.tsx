"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useReport } from "@/lib/report-context"
import { useAuth } from "@/components/auth-context"
import { createLocalFallbackComplaint, upsertLocalReport } from "@/lib/client-persistence"
import { ArrowLeft, ArrowRight, Edit2 } from "lucide-react"

export function ReviewSubmitPage() {
  const router = useRouter()
  const { reportData, updateReportData } = useReport()
  const { user, profile } = useAuth()
  const [editingField, setEditingField] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [data, setData] = useState(reportData)

  const handleFieldChange = (field: string, value: string) => {
    setData((prev) => ({
      ...prev,
      [field]: value,
      ...(field === "address" ? { exactLocation: value } : {}),
    }))
  }

  const handleSubmit = async () => {
    if (!user) {
      setSubmitError("Please sign in again before submitting your complaint.")
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    const payload = {
      ...data,
      address: data.address || profile?.addressLine1 || "",
      exactLocation: data.exactLocation || data.address || profile?.addressLine1 || "",
      city: data.city || profile?.city || "",
      pincode: data.pincode || profile?.pincode || "",
      userEmail: user.email,
      userName: user.name,
    }

    try {
      updateReportData(payload)

      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const result = await response.json()

      if (!response.ok || result?.success === false) {
        throw new Error(result?.error || "Failed to submit complaint.")
      }

      if (result?.report) {
        upsertLocalReport(result.report)
      }
      updateReportData({ tokenId: result.ticketId })
      router.push(`/report/success?token=${result.ticketId}`)
    } catch (error) {
      const fallbackComplaint = createLocalFallbackComplaint({
        userEmail: payload.userEmail,
        userName: payload.userName,
        category: payload.category || "General Issue",
        description: payload.description || "Complaint submitted from the report flow.",
        address: payload.address,
        exactLocation: payload.exactLocation,
        landmark: payload.landmark,
        city: payload.city,
        pincode: payload.pincode,
        urgency: payload.urgency || "Medium",
        photoUrl: payload.photoUrl,
        imageUrl: payload.imageUrl,
        latitude: payload.latitude,
        longitude: payload.longitude,
      })
      updateReportData({ tokenId: fallbackComplaint.ticketId })
      router.push(`/report/success?token=${fallbackComplaint.ticketId}`)
    }
  }

  const urgencyColors: Record<string, string> = {
    Low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
    Medium: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
    High: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200",
  }

  const editableFields = [
    { key: "category", label: "Category" },
    { key: "address", label: "Area" },
    { key: "city", label: "City" },
    { key: "pincode", label: "Pincode" },
    { key: "description", label: "Description" },
    { key: "urgency", label: "Urgency Level" },
  ] as const

  return (
    <div className="min-h-[calc(100vh-8rem)] bg-gradient-to-br from-background to-secondary py-12">
      <div className="max-w-2xl mx-auto px-4 w-full">
        <h1 className="text-4xl md:text-5xl font-bold mb-2">Review Your Report</h1>
        <p className="text-lg text-muted-foreground mb-8">Make sure everything is correct before submitting</p>

        <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-400 dark:border-blue-800 rounded-xl p-4 mb-8 flex gap-3">
          <span className="text-lg flex-shrink-0">i</span>
          <p className="text-sm text-blue-900 dark:text-blue-200">
            <strong>Note:</strong> These details were filled automatically from your AI call. Review and correct if
            needed.
          </p>
        </div>

        {data.photoUrl && (
          <div className="bg-card rounded-xl p-6 border border-border mb-8">
            <p className="text-sm font-semibold text-muted-foreground mb-3">Photo</p>
            <img
              src={data.photoUrl || "/placeholder.svg"}
              alt="Report"
              className="w-full h-64 object-cover rounded-lg"
            />
          </div>
        )}

        {data.departmentPrediction && (
          <div className="bg-card rounded-xl p-6 border border-border mb-8">
            <p className="text-sm font-semibold text-muted-foreground mb-2 uppercase">
              Predicted Department
            </p>
            <p className="text-xl font-semibold text-foreground">
              {data.departmentPrediction.department}
            </p>
          </div>
        )}

        <div className="space-y-4 mb-8">
          {editableFields.map(({ key, label }) => {
            const fieldValue = data[key] || ""

            return (
              <div key={key} className="bg-card rounded-xl p-6 border border-border">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-muted-foreground uppercase">{label}</label>
                <button
                  onClick={() => setEditingField(editingField === key ? null : key)}
                  className="p-2 rounded-lg hover:bg-muted transition-colors"
                >
                  <Edit2 className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {editingField === key ? (
                <div className="flex gap-2">
                  {key === "urgency" ? (
                    <select
                      value={fieldValue}
                      onChange={(e) => handleFieldChange(key, e.target.value)}
                      className="flex-1 px-4 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option>Low</option>
                      <option>Medium</option>
                      <option>High</option>
                    </select>
                  ) : (
                    <textarea
                      value={fieldValue}
                      onChange={(e) => handleFieldChange(key, e.target.value)}
                      className="flex-1 px-4 py-2 rounded-lg bg-background border border-border resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                      rows={key === "description" ? 3 : 1}
                    />
                  )}
                  <button
                    onClick={() => setEditingField(null)}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div>
                  {key === "urgency" ? (
                    <span
                      className={`inline-block px-4 py-2 rounded-full text-sm font-semibold ${urgencyColors[data.urgency || "Low"]}`}
                    >
                      {data.urgency}
                    </span>
                  ) : (
                    <p className="text-foreground font-medium whitespace-pre-wrap">{fieldValue}</p>
                  )}
                </div>
              )}
            </div>
            )
          })}
        </div>

        {submitError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        )}

        <div className="flex gap-4">
          <button
            onClick={() => router.back()}
            className="flex-1 px-6 py-3 rounded-lg border border-border text-foreground font-semibold hover:bg-muted transition-colors flex items-center justify-center gap-2"
            disabled={isSubmitting}
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <ArrowRight className="w-5 h-5 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                Submit Report
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
