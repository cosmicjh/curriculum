# 통합시간표도구

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

관리자는 학기별 교사·학생·수업·교실 자료를 등록하고 수정한다. 교사는 개인 시간표, 결보강 계획, 명렬표와 이동수업 배치표를 열람한다.

## Product Purpose

한 번 등록한 교사·수업·교실 자료를 개인시간표와 결보강에서 함께 사용한다.

## Operating Context

학교 업무용 엑셀을 등록하고 웹에서 수정·조회·인쇄한다. 사용자가 제공한 이동수업 배치표는 학년별 시간블록을 행으로, 일반교실과 특별실을 열로 배치하며 각 칸에 과목·분반·교사 목록을 담는다. 사용자는 현재 배치 내용도 운영 사이트의 첫 배치표로 등록하기로 했다.

## Capabilities and Constraints

관리자 편집과 교사 열람 권한을 구분한다. 기존 학생 배정, 비밀번호와 결보강 기록을 보존한다. GitHub Pages와 Cloudflare Worker·D1으로 운영하며 cosmicjh/timetable의 main에서 배포한다. 자동 실행 훅은 사용하지 않는다.
