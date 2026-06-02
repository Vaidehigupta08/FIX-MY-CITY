"use client"

import type React from "react"
import { createContext, useContext, useState } from "react"
import type { DepartmentPrediction } from "@/lib/types"

export interface ReportData {
  category?: string
  address?: string
  exactLocation?: string
  landmark?: string
  city?: string
  pincode?: string
  description?: string
  urgency?: "Low" | "Medium" | "High"
  photoUrl?: string
  imageUrl?: string
  latitude?: number
  longitude?: number
  tokenId?: string
  userEmail?: string
  userName?: string
  departmentPrediction?: DepartmentPrediction
}

interface ReportContextType {
  reportData: ReportData
  updateReportData: (data: Partial<ReportData>) => void
  resetReport: () => void
}

const ReportContext = createContext<ReportContextType | undefined>(undefined)

export function ReportProvider({ children }: { children: React.ReactNode }) {
  const [reportData, setReportData] = useState<ReportData>({})

  const updateReportData = (data: Partial<ReportData>) => {
    setReportData((prev) => ({ ...prev, ...data }))
  }

  const resetReport = () => {
    setReportData({})
  }

  return (
    <ReportContext.Provider value={{ reportData, updateReportData, resetReport }}>{children}</ReportContext.Provider>
  )
}

export function useReport() {
  const context = useContext(ReportContext)
  if (undefined === context) {
    throw new Error("useReport must be used within ReportProvider")
  }
  return context
}
