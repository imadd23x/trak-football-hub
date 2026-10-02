import { describe,expect,it } from 'vitest'
import { parseChildLogins,signInAddress,isGuardianCreatedChild } from '../child-login'
const row={roster_child_id:'98c00000-0000-4000-8000-000000000030',first_name:'Ana',username:null,ready:false}
describe('child login privacy and response boundary',()=>{
 it('maps ordinary email and username, never accepting a technical address as user input',()=>{
  expect(signInAddress(' Striker7 ')).toBe('striker7@child.trakfootball.com')
  expect(signInAddress('PARENT@example.test')).toBe('parent@example.test')
  expect(signInAddress('striker7@child.trakfootball.com')).toBeNull()
  expect(signInAddress('no-number')).toBeNull()
 })
 it.each([null,{},[null],[{...row,ready:true}],[{...row,username:'invalid username'}],[row,row]])('refuses malformed/missing/duplicate state %j',value=>{
  expect(()=>parseChildLogins(value)).toThrow()
 })
 it('does not pass extra provider fields or addresses into application state',()=>{
  expect(parseChildLogins([{...row,email:'private@child.trakfootball.com',password:'private'}])).toEqual([row])
  expect(parseChildLogins([])).toEqual([])
 })
 it('has no child first-run routing hint without an account',()=>expect(isGuardianCreatedChild(null)).toBe(false))
})
