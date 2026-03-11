import { Suspense } from "react"
import JoinTeamForm from "./JoinTeamForm"

export default function JoinTeamPage() {
  return (
    <Suspense>
      <JoinTeamForm />
    </Suspense>
  )
}
